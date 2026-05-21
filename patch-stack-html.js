import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'dist/index.html');

if (fs.existsSync(file)) {
  let content = fs.readFileSync(file, 'utf-8');

  // 1. Remove all carriage returns which STACK hates
  content = content.replace(/\r/g, '');
  
  // 2. Base64 encode all <style> blocks
  content = content.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, inner) => {
    const b64 = Buffer.from(inner, 'utf-8').toString('base64');
    return `<script>
(function(){
  function d(str) {
    return decodeURIComponent(atob(str).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
  }
  var style = document.createElement('style');
  style.textContent = d("${b64}");
  document.head.appendChild(style);
})();
</script>`;
  });

  // 3. Base64 encode all <script> blocks EXCEPT our STACK integration (which contains '[[cors')
  content = content.replace(/<script(?![^>]*src)([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, inner) => {
    if (inner.includes('decodeURIComponent(atob')) return match; // skip our injectors
    if (inner.includes('[[cors')) return match; // skip the STACK integration script
    
    // We MUST hide the javascript from STACK, because STACK parses $ as MathJax boundaries
    // and minified React code has hundreds of $ variables. This completely breaks the code.
    const b64 = Buffer.from(inner, 'utf-8').toString('base64');
    return `<script>
(function(){
  function d(str) {
    return decodeURIComponent(atob(str).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
  }
  function init() {
    var script = document.createElement('script');
    ${attrs.includes('type="module"') ? 'script.type = "module";' : ''}
    script.textContent = d("${b64}");
    document.body.appendChild(script);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>`;
  });

  // 4. In case any "{@" or "{#" remain in the raw HTML body, break them apart
  content = content.replace(/\{@/g, '{ @');
  content = content.replace(/\{#/g, '{ #');

  fs.writeFileSync(file, content);
  fs.writeFileSync(path.join(process.cwd(), 'public/molecule-editor.html'), content);
  console.log(`Secured HTML against STACK CASText parser by Base64 encoding scripts and styles.`);
}

