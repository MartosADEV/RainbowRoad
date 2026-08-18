// Dev server for dist/ (not shipped, not counted against the budget).
// POST /shot with a data-URL body writes a PNG next to the project, so the
// headless frame-pump harness can hand screenshots back for inspection.
import { createServer } from 'http';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

mkdirSync('shots', { recursive: true });

createServer((req, res) => {
  if (req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      try {
        const [name, url] = b.split('\n');
        mkdirSync('shots', { recursive: true });
        writeFileSync('shots/' + name + '.png', Buffer.from(url.split(',')[1], 'base64'));
        res.writeHead(200).end('ok');
      } catch (e) { res.writeHead(500).end('' + e); }
    });
    return;
  }
  try {
    const body = readFileSync(req.url === '/dev' ? 'dist/dev.html' : 'dist/index.html');
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('run: node build.mjs');
  }
}).listen(8137, () => console.log('http://localhost:8137'));
