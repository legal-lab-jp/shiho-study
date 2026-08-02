import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const failures = [];
const notices = [];

function fail(message) {
  failures.push(message);
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.name === ".git") return [];
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

function relative(file) {
  return path.relative(root, file).replaceAll("\\", "/");
}

const files = walk(root);
const htmlFiles = files.filter((file) => file.endsWith(".html"));
const publicTextFiles = files.filter((file) => /\.(?:html|js|json|md|txt|yml|yaml)$/i.test(file));

const prohibitedPatterns = [
  [/file:\/\//i, "file:// 参照"],
  [/\blocalhost\b/i, "localhost 参照"],
  [/[A-Z]:\\Users\\/i, "Windows端末内絶対パス"],
  [/\b(?:gho|ghp|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/, "GitHubトークンらしき文字列"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, "GitHub fine-grained tokenらしき文字列"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "秘密鍵"],
  [/oauth_token:\s*\S+/i, "OAuthトークン設定"]
];

for (const file of publicTextFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const [pattern, label] of prohibitedPatterns) {
    if (pattern.test(text)) fail(`${relative(file)}: ${label}が含まれています`);
  }
}

for (const file of htmlFiles) {
  const text = fs.readFileSync(file, "utf8");
  const rel = relative(file);

  if (!/<html\s+lang="ja"/i.test(text)) fail(`${rel}: lang="ja" がありません`);
  if (!/<meta\s+name="viewport"/i.test(text)) fail(`${rel}: viewport がありません`);
  if (!/<meta\s+name="description"/i.test(text)) fail(`${rel}: description がありません`);
  if (!/<title>[^<]+<\/title>/i.test(text)) fail(`${rel}: title がありません`);
  if (!/<link\s+rel="canonical"/i.test(text)) fail(`${rel}: canonical URL がありません`);
  if (!/<meta\s+property="og:title"/i.test(text)) fail(`${rel}: og:title がありません`);
  if (!/<meta\s+property="og:description"/i.test(text)) fail(`${rel}: og:description がありません`);
  if (!/<meta\s+property="og:image"/i.test(text)) fail(`${rel}: og:image がありません`);

  const ids = [...text.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) fail(`${rel}: idが重複しています (${[...new Set(duplicates)].join(", ")})`);

  for (const href of [...text.matchAll(/href="([^"]+)"/g)].map((match) => match[1])) {
    if (/^http:\/\//i.test(href)) fail(`${rel}: HTTPSではない外部リンクがあります (${href})`);
  }
}

const catalogPath = path.join(root, "data", "catalog.json");
if (!fs.existsSync(catalogPath)) {
  fail("data/catalog.json がありません");
} else {
  let catalog = [];
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  } catch (error) {
    fail(`data/catalog.json を解析できません: ${error.message}`);
  }

  const ids = new Set();
  const urls = new Set();
  const required = ["id", "title", "slug", "url", "subject", "tags", "status", "updated"];

  for (const [index, item] of catalog.entries()) {
    for (const key of required) {
      if (!(key in item)) fail(`catalog[${index}]: ${key} がありません`);
    }
    if (ids.has(item.id)) fail(`catalog: id ${item.id} が重複しています`);
    if (urls.has(item.url)) fail(`catalog: url ${item.url} が重複しています`);
    ids.add(item.id);
    urls.add(item.url);

    if (item.status === "published") {
      const expected = path.join(root, item.url, "index.html");
      if (!fs.existsSync(expected)) {
        fail(`catalog: ${item.url} に公開HTMLがありません`);
      } else {
        const material = fs.readFileSync(expected, "utf8");
        if (!material.includes("法令・公的資料は")) {
          fail(`${item.id}: 法令・公的資料の確認日がありません`);
        }
        if (!material.includes("個別事件への法的助言ではありません")) {
          fail(`${item.id}: 学習用・非法律助言の表示がありません`);
        }
        if (!material.includes("再利用")) {
          fail(`${item.id}: 再利用方針がありません`);
        }
        if (!fs.readFileSync(path.join(root, "index.html"), "utf8").includes(item.url)) {
          fail(`${item.id}: 一覧ページにURLが登録されていません`);
        }
      }
    }
  }
  notices.push(`catalog: ${catalog.filter((item) => item.status === "published").length}件を確認`);
}

if (failures.length) {
  console.error(`FAIL (${failures.length})`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(`PASS: ${htmlFiles.length} HTML / ${files.length} files`);
for (const message of notices) console.log(`- ${message}`);
