// Keep each story entry on one line, with books and chapters easy to locate.
export function stringifyStorybook(data) {
  function formatObject(object, depth) {
    const indent = "  ".repeat(depth);
    const fields = Object.entries(object).map(([key, value]) => {
      let text = JSON.stringify(value);
      if (Array.isArray(value) && ["books", "chapters", "entries"].includes(key) && value.length) {
        const rows = value.map((item) => key === "books"
          ? formatObject(item, depth + 2)
          : JSON.stringify(item));
        text = `[\n${rows.map((row) => `${indent}    ${row}`).join(",\n")}\n${indent}  ]`;
      }
      return `${indent}  ${JSON.stringify(key)}: ${text}`;
    });
    return fields.length ? `{\n${fields.join(",\n")}\n${indent}}` : "{}";
  }

  return formatObject(data, 0);
}
