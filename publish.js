export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { password, title, date, body } = req.body;

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = 'rando000';
  const repo = 'writing';
  const path = 'index.html';

  // Get current file
  const getRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
  });
  const fileData = await getRes.json();
  const currentContent = Buffer.from(fileData.content, 'base64').toString('utf8');
  const sha = fileData.sha;

  // Build new essay HTML block
  const essayId = 'essay_' + Date.now();
  const escapedBody = body.replace(/`/g, '\\`');

  // Insert list item into home page
  const listItem = `
      <li class="essay-item">
        <a class="essay-link" href="#" onclick="showEssay('${essayId}'); return false;">${title}</a>
        <span class="essay-date">${date}</span>
      </li>`;

  // Insert essay page before closing home div marker
  const essayBlock = `
  <!-- ${essayId} -->
  <div id="${essayId}" class="page">
    <a class="back-link" href="#" onclick="showPage('home'); return false;">← Essays</a>
    <div class="essay-header">
      <h1 class="essay-title">${title}</h1>
      <div class="essay-meta">${date}</div>
    </div>
    <div class="essay-body">
      ${body.split('\n\n').map(p => `<p>${p.trim()}</p>`).join('\n      ')}
    </div>
  </div>`;

  let updated = currentContent;

  // Add list item after first <li class="essay-item"> block open
  updated = updated.replace('<ul class="essays">', `<ul class="essays">${listItem}`);

  // Add essay block before about page
  updated = updated.replace('  <!-- ABOUT PAGE -->', `${essayBlock}\n\n  <!-- ABOUT PAGE -->`);

  const newContent = Buffer.from(updated).toString('base64');

  const pushRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Add essay: ${title}`, content: newContent, sha })
  });

  if (!pushRes.ok) {
    const err = await pushRes.json();
    return res.status(500).json({ error: err.message });
  }

  return res.status(200).json({ ok: true });
}
