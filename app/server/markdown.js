// server/markdown.js — a minimal, dependency-free renderer for the specific
// markdown subset the validation reports use (headers, tables, bold, italic,
// blockquotes, lists, hr, paragraphs). Not a general CommonMark implementation
// — deliberately narrow so there's no parser-injection surface to worry about.
// All text content is HTML-escaped before any markup is applied.
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function inline(s) {
  let t = esc(s);
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
  t = t.replace(/`([^`]+?)`/g, '<code>$1</code>');
  return t;
}

export function renderMarkdown(src) {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { closeList(); i++; continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); i++; continue; }

    if (/^>\s?/.test(line)) {
      closeList();
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    if (/^\|.*\|\s*$/.test(line)) {
      closeList();
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cellsOf = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const header = cellsOf(rows[0]);
      const body = rows.slice(2); // row 1 is the |---|---| separator
      out.push('<div class="report-table"><table><thead><tr>' +
        header.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + cellsOf(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table></div>');
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      i++; continue;
    }

    if (/^---+\s*$/.test(line)) { closeList(); out.push('<hr>'); i++; continue; }

    closeList();
    const buf = [line];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,4})\s/.test(lines[i]) && !/^\|.*\|\s*$/.test(lines[i]) && !/^[-*]\s+/.test(lines[i]) && !/^>\s?/.test(lines[i])) {
      buf.push(lines[i]); i++;
    }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  closeList();
  return out.join('\n');
}
