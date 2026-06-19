document.getElementById('nzBtn').addEventListener('click', () => {
  const notes = Math.max(2, Math.min(15, parseInt(document.getElementById('nzNotes').value) || 6));
  const minutes = Math.max(3, Math.min(30, parseInt(document.getElementById('nzMin').value) || 8));
  const msg = document.getElementById('nzMsg');
  msg.textContent = '正在打开小红书…';
  chrome.runtime.sendMessage({ type: 'nurture', cfg: { notes, minutes } }, (resp) => {
    msg.textContent = (resp && resp.ok) ? '✓ 已开始，去新开的小红书标签看进度' : '启动失败';
    setTimeout(() => window.close(), 900);
  });
});
