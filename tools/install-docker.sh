#!/usr/bin/env bash
set -eu

install_dir="${ATO_DIR:-$PWD}"
repo_url="${ATO_REPO_URL:-https://github.com/banard2049-cpu/ATO_assistant.git}"
mkdir -p "$install_dir"
install_dir="$(cd "$install_dir" && pwd)"
cd "$install_dir"

# Read only the settings we own; .env is Compose data, never executable shell code.
env_value() {
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | head -n 1 | tr -d '\r' | sed "s/^['\"]//; s/['\"]$//"
}

save_setting() {
  local key="$1" value="$2"
  touch .env
  sed "/^${key}=/d" .env > .env.ato-tmp
  printf '%s=%s\n' "$key" "$value" >> .env.ato-tmp
  mv .env.ato-tmp .env
}

fetch_version() {
  local latest
  latest="$(git ls-remote --tags --refs --sort=-v:refname "$repo_url" 'v*' 2>/dev/null \
    | head -n 1 | sed 's#.*refs/tags/v##')" || true
  if [ -z "$latest" ]; then
    echo "错误：无法确定版本号；请设置 ATO_VERSION 为发布页上的版本号后重试。" >&2
    return 1
  fi
  printf '%s' "$latest"
}

build_local_image() {
  local version="$1" source_dir="$install_dir/.ato-src"
  local context="$source_dir/tools/.ato-build/ATO-Assistant-Docker-${version}"
  echo "预构建镜像不可用，按本机架构构建 ato-assistant:${version} ……"
  if command -v git >/dev/null 2>&1; then
    if [ -d "$source_dir/.git" ]; then
      git -C "$source_dir" fetch --depth 1 origin "refs/tags/v${version}:refs/tags/v${version}"
      git -C "$source_dir" checkout -q "v${version}"
    else
      # Do not delete an existing directory that the installer did not create.
      git clone --depth 1 --branch "v${version}" "$repo_url" "$source_dir"
    fi
  else
    mkdir -p "$source_dir"
    curl -fsSL "${repo_url%.git}/archive/refs/tags/v${version}.tar.gz" \
      | tar -xz --strip-components=1 -C "$source_dir"
  fi
  if [ ! -f "$source_dir/tools/packaging/docker/Dockerfile" ]; then
    echo "错误：v${version} 的源码缺少 Dockerfile。" >&2
    return 1
  fi
  # Dockerfile expects an audited app/ export, not the raw source directory.
  # The helper container runs the release exporter and standard-library ZIP
  # extraction, including on hosts without Python.
  docker run --rm -v "$source_dir:/source" -w /source python:3.12-alpine \
    sh -ec 'python tools/export_portable.py --target docker --version "$1"; python -m zipfile -e "export/ATO-Assistant-Docker-$1.zip" tools/.ato-build' sh "$version"
  if [ ! -f "$context/Dockerfile" ] || [ ! -f "$context/app/index.html" ]; then
    echo "错误：Docker 构建目录不完整：$context" >&2
    return 1
  fi
  docker build -t "ato-assistant:${version}" "$context"
  image="ato-assistant:${version}"
  policy=never
}

main() {
  local version requested_image managed_image compose_ref
  version="${ATO_VERSION:-$(env_value ATO_VERSION)}"
  requested_image="${ATO_IMAGE:-$(env_value ATO_IMAGE)}"
  managed_image="$(cat .ato-managed-image 2>/dev/null || true)"
  if [ "$requested_image" = "$managed_image" ] && [ -z "${ATO_IMAGE:-}" ]; then
    requested_image=""
  fi
  # A version pin also selects its Compose file: current mounts must never be
  # paired with an older image that lacks the matching entrypoint restore.
  compose_ref=main
  if [ -n "$version" ]; then
    if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
      echo "错误：ATO_VERSION 不是有效的发布版本号：$version" >&2
      return 1
    fi
    compose_ref="v${version}"
  fi
  curl -fsSL "https://raw.githubusercontent.com/banard2049-cpu/ATO_assistant/${compose_ref}/tools/packaging/docker/compose.yaml" -o compose.yaml
  curl -fsSL "https://raw.githubusercontent.com/banard2049-cpu/ATO_assistant/${compose_ref}/tools/packaging/docker/README.txt" -o README-DOCKER.txt
  # Older matching Compose files did not expose an image override. Normalize
  # only the service image/policy, preserving their version-compatible mounts.
  sed -i \
    -e 's|^\([[:space:]]*\)image: .*|\1image: ${ATO_IMAGE:-ghcr.io/banard2049-cpu/ato_assistant:${ATO_VERSION:-latest}}|' \
    -e 's|^\([[:space:]]*\)pull_policy: .*|\1pull_policy: ${ATO_PULL_POLICY:-always}|' \
    -e '/^[[:space:]]*build: /d' compose.yaml
  if ! grep -q 'ATO_IMAGE' compose.yaml; then
    echo "错误：Compose 文件里没有可用的 image 配置。" >&2
    return 1
  fi

  mkdir -p app/aibp/ps \
    app/assets/exploration-cards app/assets/story-doom-cards app/assets/cycle-symbols app/assets/icons \
    app/assets/bgm app/assets/bgm/audio app/hero/assets app/map/images app/map/tokens app/record/assets \
    app/ss/terrain app/ss/terrain-cards app/story/images app/story/data app/technology/images \
    app/story/assets/cryptic/glyphs app/story/assets/mixed-media/images app/story/assets/OO
  if [ ! -e app/ss/battle-board.jpg ]; then
    : > app/ss/battle-board.jpg
    echo "已创建 app/ss/battle-board.jpg 占位文件；请覆盖为决战版图底图。"
  fi
  # 混合媒体映射表是单文件挂载：先放一个空占位文件，否则 Docker 会建同名目录顶上去，
  # 混排图（正文里的书籍裁图）会全部加载失败。
  if [ ! -e app/story/assets/mixed-media/mapping.js ]; then
    : > app/story/assets/mixed-media/mapping.js
    echo "已创建 app/story/assets/mixed-media/mapping.js 占位文件；请用资料包里的映射表覆盖它。"
  fi

  policy=always
  if [ -n "$requested_image" ]; then
    image="$requested_image"
    if docker image inspect "$image" >/dev/null 2>&1; then
      policy=never
    else
      docker pull "$image"
    fi
  else
    image="ghcr.io/banard2049-cpu/ato_assistant:${version:-latest}"
    if docker pull "$image" 2>/dev/null; then
      echo "已拉取预构建镜像 ${image}。"
    else
      version="${version:-$(fetch_version)}"
      build_local_image "$version"
    fi
    printf '%s\n' "$image" > .ato-managed-image
  fi
  save_setting ATO_IMAGE "$image"
  save_setting ATO_PULL_POLICY "$policy"
  # Compose's process environment takes precedence over .env.
  export ATO_IMAGE="$image" ATO_PULL_POLICY="$policy"
  docker compose up -d
  echo "ATO Assistant 已启动：http://服务器IP:8793/"
  echo "第二屏幕：http://服务器IP:8793/ss/（先在主控台的「用户与存档」里开启）"
}

main "$@"
