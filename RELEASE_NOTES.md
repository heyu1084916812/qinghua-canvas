# 轻画 · 发行说明

> 每个版本的交付内容、修复、已知问题与数据迁移说明（产品文档 §16.1）。
> 版本遵循 SemVer；npm 包与 `shared-core` 的 schema / protocol 版本分别管理（§16.4）。

**2026-11-14 拆分**：原先所有版本挤在一个 1378 行的文件里，改动一个版本的说明要滚过全部历史。
现在**每个版本一篇** `release-notes/v<版本>.md`，本文件只留索引。
发版脚本 `scripts/release-desktop.mjs` 按 `release-notes/v<版本>.md` 里的 `## <版本> ` 段取更新说明。

## 版本索引

| 文件 | 版本 | 日期 |
| --- | --- | --- |
| `release-notes/v0.1.17.md` | 0.1.17 | 2026-11-08 |
| `release-notes/v0.1.16.md` | 0.1.16 | 2026-11-05 |
| `release-notes/v0.1.14.md` | 0.1.14 | 2026-11-04 |
| `release-notes/v0.1.13.md` | 0.1.13 | 2026-11-02 |
| `release-notes/v0.1.12.md` | 0.1.12 | 2026-11-02 |
| `release-notes/v0.1.11.md` | 0.1.11 | 2026-10-30 |
| `release-notes/v0.1.10.md` | 0.1.10 | 2026-10-29 |
| `release-notes/v0.1.9.md` | 0.1.9 | 2026-10-29 |
| `release-notes/v0.1.8.md` | 0.1.8 | 2026-10-24 |
| `release-notes/v0.1.7.md` | 0.1.7 | 2026-10-24 |
| `release-notes/v0.1.6.md` | 0.1.6 | 2026-10-24 |
| `release-notes/v0.1.4.md` | 0.1.4 | 2026-10-14 |
| `release-notes/v0.1.3.md` | 0.1.3 | 2026-10-12 |
| `release-notes/v0.1.2.md` | 0.1.2 | 2026-10-12 |
| `release-notes/v0.1.1.md` | 0.1.1 | 2026-10-12 |
| `release-notes/archive-0.1.0-and-earlier.md` | 0.1.0 及更早 | 2026-09 ~ 2026-10 |

## 写新版本说明的规矩

1. **一个版本一个新文件**：`release-notes/v<版本>.md`，文件里必须有 `## <版本> · <标题>（<日期>）` 这一行（发版脚本按它切段）；
2. **只写这一版**：不要回头改旧版本的文件；旧版本的错字也不改（history 就是 history）；
3. **本文件只维护索引**：加一行，说明写在对应文件里；
4. 体积上限与其它文档一样受 `scripts/check-doc-size.mjs` 管。
