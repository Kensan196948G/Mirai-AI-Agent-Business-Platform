/**
 * 日本語を含む相談文から検索語を取り出す（B-12）。
 * 以前は空白区切りだけだったため、「港湾のケーソン据付工事で MC-Caisson を…」のような文は
 * 長い塊のまま ILIKE され、実質ヒットしなかった。
 *
 * 取り出す単位:
 *  - 英数字の技術名・型番（MC-Caisson, CPG, QSK-230004-A）
 *  - カタカナ語（ケーソン、ポンプ）
 *  - 漢字の連続（港湾、据付、地盤改良）。長い漢字列は 2 文字の窓でも切り、複合語の一部にも一致させる
 * 助詞・記号・1 文字の断片は捨てる。
 */
const STOP = new Set(['こと', 'もの', 'ため', 'これ', 'それ', 'あれ', 'よう', 'とき', 'ところ', 'について', 'ください', 'です', 'ます', 'する', 'した', 'して', 'ある', 'いる', 'なる', 'できる', 'おり', 'また', 'および', '場合', '条件', '実績', '技術', '工事', '提案', '論点', '適用', '教えて', '検討', '比較', '整理', '確認']);

export function extractSearchTokens(query, { max = 12 } = {}) {
  const text = String(query || '').replace(/[%_]/g, ' ');
  const found = [];
  const push = (t) => { if (t && t.length >= 2 && !STOP.has(t) && !found.includes(t)) found.push(t); };

  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)*/g)) push(m[0]);
  for (const m of text.matchAll(/[ァ-ヶー]{2,}/g)) push(m[0]);
  for (const m of text.matchAll(/[一-龠々]{2,}/g)) {
    const run = m[0];
    push(run);
    if (run.length >= 4) for (let i = 0; i + 2 <= run.length; i += 2) push(run.slice(i, i + 2));
  }
  // 技術名の一部（例: MC-Caisson → Caisson）にも一致させる
  for (const t of [...found]) {
    if (/-/.test(t)) for (const part of t.split('-')) if (part.length >= 3 && !/^\d+$/.test(part)) push(part);
  }
  return found.slice(0, max);
}
