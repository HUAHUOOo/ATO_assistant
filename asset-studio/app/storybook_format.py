"""Readable storybook JSON: each chapter and story entry occupies one line."""

import json


def format_storybook(data: dict) -> str:
    def compact(value):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    def format_object(obj, depth):
        indent = "  " * depth
        fields = []
        for key, value in obj.items():
            text = compact(value)
            if key in ("books", "chapters", "entries") and isinstance(value, list) and value:
                rows = [
                    format_object(item, depth + 2) if key == "books" else compact(item)
                    for item in value
                ]
                text = "[\n" + ",\n".join(indent + "    " + row for row in rows) + "\n" + indent + "  ]"
            fields.append(indent + "  " + compact(key) + ": " + text)
        return "{\n" + ",\n".join(fields) + "\n" + indent + "}" if fields else "{}"

    return format_object(data, 0)
