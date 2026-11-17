export const pageCount = (total, size) => Math.floor(total / size);

export const page = (items, number, size) => {
  if (number < 1 || number > pageCount(items.length, size)) return [];
  return items.slice((number - 1) * size, number * size);
};
