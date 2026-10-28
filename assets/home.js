// Landing page: stars, reveal-on-scroll, copy buttons, and paid plans shown once checkout is open.
document.documentElement.classList.toggle('billing-open', !!(window.MCVSC && window.MCVSC.billingOpen));

// stars
const stars = document.getElementById('stars');
for (let i = 0; i < 40; i++) {
  const s = document.createElement('i');
  s.style.left = Math.random() * 100 + '%';
  s.style.top = Math.random() * 70 + '%';
  s.style.animationDelay = (Math.random() * 3) + 's';
  if (Math.random() > .7) { s.style.width = s.style.height = '4px'; }
  stars.appendChild(s);
}

// reveal on scroll
const io = new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
}), { threshold: .12 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// copy
document.querySelectorAll('.copy').forEach(b => b.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied!'; }
  catch { b.textContent = 'Select & copy'; }
  setTimeout(() => b.textContent = 'Copy', 1500);
}));
