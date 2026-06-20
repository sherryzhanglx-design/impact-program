/**
 * LifeMaster IMPACT Program — Content Protection
 * Layers: 1) Copy/Select/Right-click block  2) Watermark  3) Print block  4) Dev tools block  5) Legal notice
 */

(function() {
  'use strict';

  // ===== LAYER 1: Disable copy, cut, select, right-click, drag =====
  document.addEventListener('contextmenu', function(e) { e.preventDefault(); });
  document.addEventListener('copy', function(e) { e.preventDefault(); });
  document.addEventListener('cut', function(e) { e.preventDefault(); });
  document.addEventListener('dragstart', function(e) { e.preventDefault(); });
  document.addEventListener('selectstart', function(e) {
    // Allow selection in input/textarea for forms
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    e.preventDefault();
  });

  // Block common copy shortcuts
  document.addEventListener('keydown', function(e) {
    // Ctrl+C, Ctrl+X, Ctrl+A, Ctrl+S, Ctrl+U (view source)
    if ((e.ctrlKey || e.metaKey) && ['c','x','a','s','u'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
    // Ctrl+P (print)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
      e.preventDefault();
    }
    // F12 (dev tools)
    if (e.key === 'F12') {
      e.preventDefault();
    }
    // Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C (dev tools)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i','j','c'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  });

  // CSS: disable text selection and drag
  var protectionCSS = document.createElement('style');
  protectionCSS.textContent = [
    '* { -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none; -webkit-user-drag: none; }',
    'input, textarea { -webkit-user-select: text; -moz-user-select: text; -ms-user-select: text; user-select: text; }',
    // LAYER 3: Hide content when printing
    '@media print { body { display: none !important; } }',
    '@media print { html::after { content: "This content is protected. Printing is not allowed."; display: block; text-align: center; padding: 100px 20px; font-size: 24px; color: #999; } }'
  ].join('\n');
  document.head.appendChild(protectionCSS);

  // ===== LAYER 2: Watermark =====
  function createWatermark() {
    var existing = document.getElementById('lm-watermark');
    if (existing) existing.remove();

    var canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 200;
    var ctx = canvas.getContext('2d');
    ctx.font = '13px DM Sans, sans-serif';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
    ctx.translate(180, 100);
    ctx.rotate(-25 * Math.PI / 180);
    ctx.textAlign = 'center';
    ctx.fillText('LifeMaster IMPACT Program', 0, -8);
    ctx.fillText('Licensed Material', 0, 12);

    var watermarkDiv = document.createElement('div');
    watermarkDiv.id = 'lm-watermark';
    watermarkDiv.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'width: 100%',
      'height: 100%',
      'pointer-events: none',
      'z-index: 99999',
      'background-image: url(' + canvas.toDataURL() + ')',
      'background-repeat: repeat'
    ].join(';');
    document.body.appendChild(watermarkDiv);

    // Protect watermark from removal via dev tools
    var observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        m.removedNodes.forEach(function(node) {
          if (node.id === 'lm-watermark') {
            document.body.appendChild(watermarkDiv);
          }
        });
      });
      if (watermarkDiv.style.display === 'none' || watermarkDiv.style.visibility === 'hidden' || watermarkDiv.style.opacity === '0') {
        watermarkDiv.style.display = 'block';
        watermarkDiv.style.visibility = 'visible';
        watermarkDiv.style.opacity = '1';
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  }

  // ===== LAYER 4: Dev tools detection =====
  // Detect dev tools open via debugger timing
  (function detectDevTools() {
    var threshold = 160;
    setInterval(function() {
      var widthThreshold = window.outerWidth - window.innerWidth > threshold;
      var heightThreshold = window.outerHeight - window.innerHeight > threshold;
      if (widthThreshold || heightThreshold) {
        document.title = 'Developer tools detected — LifeMaster IMPACT Program';
      }
    }, 2000);
  })();

  // ===== LAYER 5: Legal notice on first visit =====
  function showLegalNotice() {
    var noticeKey = 'lm-impact-legal-accepted';
    if (sessionStorage.getItem(noticeKey)) return;

    var overlay = document.createElement('div');
    overlay.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 0',
      'width: 100%',
      'height: 100%',
      'background: rgba(0,0,0,0.5)',
      'backdrop-filter: blur(8px)',
      '-webkit-backdrop-filter: blur(8px)',
      'z-index: 999999',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'padding: 20px'
    ].join(';');

    var dialog = document.createElement('div');
    dialog.style.cssText = [
      'background: white',
      'border-radius: 20px',
      'padding: 36px 32px 28px',
      'max-width: 480px',
      'width: 100%',
      'box-shadow: 0 20px 60px rgba(0,0,0,0.15)',
      'text-align: center',
      'font-family: DM Sans, -apple-system, sans-serif'
    ].join(';');

    dialog.innerHTML = [
      '<div style="font-size:32px;margin-bottom:12px;">🔒</div>',
      '<h2 style="font-family:Playfair Display,serif;font-size:22px;font-weight:700;color:#1F2937;margin-bottom:8px;">Licensed Learning Material</h2>',
      '<p style="font-size:13px;color:#4B5563;line-height:1.7;margin-bottom:6px;">This content is the proprietary intellectual property of <strong>LifeMaster</strong> and is provided exclusively for enrolled participants of the <strong>IMPACT Leadership Accelerator Program</strong>.</p>',
      '<p style="font-size:13px;color:#4B5563;line-height:1.7;margin-bottom:6px;">本内容为 <strong>LifeMaster</strong> 的专有知识产权，仅供 <strong>IMPACT 领导力加速器项目</strong>的注册学员使用。</p>',
      '<p style="font-size:12px;color:#9CA3AF;line-height:1.6;margin-bottom:20px;">Unauthorized reproduction, distribution, or sharing of any materials on this site is strictly prohibited and may result in legal action.<br>未经授权，严禁复制、分发或分享本网站的任何内容。</p>',
      '<button id="lm-accept-btn" style="background:#0F766E;color:white;border:none;padding:12px 32px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif;transition:all 0.2s;">I Understand & Agree 我理解并同意</button>'
    ].join('');

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    document.getElementById('lm-accept-btn').addEventListener('click', function() {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.3s ease';
      setTimeout(function() {
        overlay.remove();
      }, 300);
      sessionStorage.setItem(noticeKey, 'true');
    });
  }

  // ===== Initialize =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      createWatermark();
      showLegalNotice();
    });
  } else {
    createWatermark();
    showLegalNotice();
  }

  // ===== Footer copyright =====
  window.addEventListener('load', function() {
    var footers = document.querySelectorAll('.footer, .closing');
    footers.forEach(function(f) {
      if (!f.querySelector('.lm-copyright')) {
        var copy = document.createElement('div');
        copy.className = 'lm-copyright';
        copy.style.cssText = 'font-size:10px;color:#9CA3AF;margin-top:12px;letter-spacing:0.5px;';
        copy.textContent = '© 2025-2026 LifeMaster. All rights reserved. Unauthorized use is prohibited.';
        f.appendChild(copy);
      }
    });
  });

})();
