import { readFile } from 'node:fs/promises';
const url = new URL(process.argv[2]);
if (url.protocol !== 'https:' || url.href !== url.origin + '/') {
  throw new Error('Pass the HTTPS integration origin.');
}
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [html, css, js] = await Promise.all([read('./theme/jollyrx.html'), read('./css/jollyrx.css'), read('./js/jollyrx.js')]);
process.stdout.write(html.replace('__JOLLYRX_API__', url.origin) + '\n<style>\n' + css +
  '\n</style>\n<script>\n' + js + '\n</script>\n');

