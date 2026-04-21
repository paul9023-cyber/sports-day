// 자물쇠 스타일 휠 피커
// - values: 배열 (예: [10, 20, 30, ...180])
// - scrollEl: .wheel-scroll 요소
// - itemHeight: 각 item 높이 (style.css의 .wheel-item과 일치)
// - onChange(value): 선택이 바뀔 때 호출

export function createWheel({ scrollEl, values, itemHeight = 56, onChange }) {
  scrollEl.innerHTML = "";

  // 위/아래 공백으로 item이 정중앙에 올 수 있게
  const padTop = document.createElement("div");
  const padBot = document.createElement("div");
  padTop.style.height = `${(scrollEl.clientHeight - itemHeight) / 2}px`;
  padBot.style.height = `${(scrollEl.clientHeight - itemHeight) / 2}px`;
  scrollEl.appendChild(padTop);

  const itemEls = [];
  for (const v of values) {
    const d = document.createElement("div");
    d.className = "wheel-item";
    d.textContent = v;
    d.dataset.value = v;
    scrollEl.appendChild(d);
    itemEls.push(d);
  }
  scrollEl.appendChild(padBot);

  let currentIdx = -1;
  let raf = null;

  function update() {
    const top = scrollEl.scrollTop;
    const idx = Math.round(top / itemHeight);
    const clamped = Math.max(0, Math.min(values.length - 1, idx));
    if (clamped !== currentIdx) {
      currentIdx = clamped;
      itemEls.forEach((e, i) => {
        e.classList.toggle("active", i === clamped);
      });
      onChange && onChange(values[clamped]);
    }
    // 3D-like rotation for each item
    itemEls.forEach((e, i) => {
      const center = (i * itemHeight) + itemHeight / 2;
      const viewCenter = top + scrollEl.clientHeight / 2;
      const diff = (center - viewCenter) / itemHeight; // 중심으로부터 거리(아이템 단위)
      const absDiff = Math.abs(diff);
      const rot = Math.max(-60, Math.min(60, diff * 18));
      const scale = Math.max(0.7, 1 - absDiff * 0.12);
      const opacity = Math.max(0.25, 1 - absDiff * 0.3);
      e.style.transform = `perspective(400px) rotateX(${-rot}deg) scale(${scale})`;
      e.style.opacity = opacity;
    });
  }

  scrollEl.addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; update(); });
  }, { passive: true });

  // 탭으로 이동
  scrollEl.addEventListener("click", (e) => {
    const item = e.target.closest(".wheel-item");
    if (!item) return;
    const idx = itemEls.indexOf(item);
    if (idx >= 0) scrollToIndex(idx, true);
  });

  function scrollToIndex(idx, smooth = true) {
    const clamped = Math.max(0, Math.min(values.length - 1, idx));
    scrollEl.scrollTo({ top: clamped * itemHeight, behavior: smooth ? "smooth" : "auto" });
  }

  function setValue(v, smooth = true) {
    const idx = values.indexOf(v);
    if (idx >= 0) scrollToIndex(idx, smooth);
  }

  function getValue() {
    return currentIdx >= 0 ? values[currentIdx] : values[0];
  }

  // 초기화: 첫 항목에 위치
  requestAnimationFrame(() => {
    scrollToIndex(0, false);
    update();
  });

  return { setValue, getValue, update };
}
