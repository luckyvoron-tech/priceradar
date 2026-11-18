const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "app", "js", "match.js"), "utf8");
eval(src + "\n;globalThis.Match = Match;");
const M = globalThis.Match;

const cases = [
  ["Apple iPhone 15 128GB", "Apple iPhone 15 128 ГБ", 69990, 71990],
  ["Apple iPhone 15 128GB", "Apple iPhone 15 Pro 128GB", 69990, 69990],
  ["Apple iPhone 15 128GB", "Apple iPhone 15 256GB", 69990, 79990],
  ["Samsung Galaxy S24 SM-S921B 8/256", "Samsung Galaxy S24 8/256 SM-S921B", 64990, 62990],
  ["Наушники Sony WH-1000XM5", "Чехол для наушников Sony WH-1000XM5", 29990, 1990],
  ["Кроссовки Nike Air Max 270 размер 42", "Кроссовки Nike Air Max 270 размер 43", 12990, 12990],
  ["Платье женское летнее размер M", "Платье женское летнее размер L", 2990, 2990],
  ["Apple iPhone 15 128GB", "Apple iPhone 15 128GB", 69990, 129990],
  ["Смартфон Apple iPhone 15 128 ГБ черный", "Apple iPhone 15 128 ГБ, черный", 47235, 45370],
];

for (const [a, b, pa, pb] of cases) {
  const r = M.match({ title: a, price: pa }, { title: b, price: pb });
  console.log(r.score.toFixed(3), "same=" + r.isSame, "sim=" + r.isSimilar, "|", a, "||", b, "|", r.reason);
}
