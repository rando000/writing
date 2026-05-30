export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { password, action, title, date, body, essayId } = req.body;

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
  let content = Buffer.from(fileData.content, 'base64').toString('utf8');
  const sha = fileData.sha;

  if (action === 'list') {
    // Parse essay list from index.html
    const essays = [];
    const listRegex = /<li class="essay-item">[\s\S]*?<a class="essay-link"[^>]*onclick="showEssay\('([^']+)'\)[^"]*"[^>]*>([^<]+)<\/a>\s*<span class="essay-date">([^<]+)<\/span>/g;
    let match;
    while ((match = listRegex.exec(content)) !== null) {
      essays.push({ id: match[1], title: match[2].trim(), date: match[3].trim() });
    }
    return res.status(200).json({ essays });
  }

  if (action === 'get') {
    // Extract essay body text
    const bodyRegex = new RegExp(`<!-- ${essayId} -->[\\s\\S]*?<div class="essay-body">([\\s\\S]*?)<\\/div>\\s*<\\/div>`);
    const match = content.match(bodyRegex);
    if (!match) return res.status(404).json({ error: 'Essay not found' });
    const rawBody = match[1].replace(/<p>/g, '').replace(/<\/p>/g, '\n\n').trim();
    return res.status(200).json({ body: rawBody });
  }

  if (action === 'publish') {
    const newId = 'essay_' + Date.now();
    const listItem = `
      <li class="essay-item">
        <a class="essay-link" href="#" onclick="showEssay('${newId}'); return false;">${title}</a>
        <span class="essay-date">${date}</span>
      </li>`;
    const essayBlock = `
  <!-- ${newId} -->
  <div id="${newId}" class="page">
    <a class="back-link" href="#" onclick="showPage('home'); return false;">← Essays</a>
    <div class="essay-header">
      <h1 class="essay-title">${title}</h1>
      <div class="essay-meta">${date}</div>
    </div>
    <div class="essay-body">
      ${body.split('\n\n').map(p => `<p>${p.trim()}</p>`).join('\n      ')}
    </div>
  </div>`;
    content = content.replace('<ul class="essays">', `<ul class="essays">${listItem}`);
    content = content.replace('  <!-- ABOUT PAGE -->', `${essayBlock}\n\n  <!-- ABOUT PAGE -->`);
    const msg = `Add essay: ${title}`;
    return await pushToGitHub(token, owner, repo, path, content, sha, msg, res);
  }

  if (action === 'edit') {
    // Replace list item title and date
    const listRegex = new RegExp(`(<li class="essay-item">[\\s\\S]*?<a class="essay-link"[^>]*onclick="showEssay\\('${essayId}'\\)[^"]*"[^>]*>)[^<]+(</a>\\s*<span class="essay-date">)[^<]+(</span>)`);
    content = content.replace(listRegex, `$1${title}$2${date}$3`);
    // Replace essay page content
    const essayRegex = new RegExp(`(<!-- ${essayId} -->[\\s\\S]*?<h1 class="essay-title">)[^<]+(</h1>\\s*<div class="essay-meta">)[^<]+(</div>\\s*<div class="essay-body">)[\\s\\S]*?(<\\/div>\\s*<\\/div>)`);
    const newBody = body.split('\n\n').map(p => `<p>${p.trim()}</p>`).join('\n      ');
    content = content.replace(essayRegex, `$1${title}$2${date}$3\n      ${newBody}\n    $4`);
    return await pushToGitHub(token, owner, repo, path, content, sha, `Edit essay: ${title}`, res);
  }

  if (action === 'delete') {
    // Remove list item
    const listRegex = new RegExp(`\\s*<li class="essay-item">[\\s\\S]*?onclick="showEssay\\('${essayId}'\\)[^"]*"[\\s\\S]*?</li>`);
    content = content.replace(listRegex, '');
    // Remove essay block
    const essayRegex = new RegExp(`\\s*<!-- ${essayId} -->[\\s\\S]*?</div>\\s*</div>`);
    content = content.replace(essayRegex, '');
    return await pushToGitHub(token, owner, repo, path, content, sha, `Delete essay: ${essayId}`, res);
  }

  return res.status(400).json({ error: 'Unknown action' });
}

async function pushToGitHub(token, owner, repo, path, content, sha, message, res) {
  const newContent = Buffer.from(content).toString('base64');
  const pushRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: newContent, sha })
  });
  if (!pushRes.ok) {
    const err = await pushRes.json();
    return res.status(500).json({ error: err.message });
  }
  return res.status(200).json({ ok: true });
}
