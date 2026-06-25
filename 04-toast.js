// ═══ TOAST NOTIFICATIONS ═══

function showToast(msg, type) {
  const existing = el('toastMsg');
  if(existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'toastMsg';
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:8px;font-size:13px;font-weight:500;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.15);max-width:90vw;text-align:center;';
  t.style.background = type === 'success' ? '#1a7a4a' : '#c0392b';
  t.style.color = '#fff';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

