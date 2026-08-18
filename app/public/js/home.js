// public/js/home.js — renders the illustrated paytable on the marketing page
// from the live engine constants embedded by the server (window.WGC_PAYDATA).
import { svgFor } from '/js/art.js';

const D = window.WGC_PAYDATA;
const ORDER_A = ['horseshoe', 'cactus', 'mesa', 'nugget', 'spur', 'lantern', 'wheel', 'canteen', 'lasso'];
const ORDER_B = ORDER_A;

function table(rows, kinds) {
  let h = '<div class="data-table-wrap"><table class="data"><thead><tr><th>Symbol</th><th class="num">3x</th><th class="num">4x</th><th class="num">5x</th></tr></thead><tbody>';
  rows.forEach((r, i) => {
    h += `<tr><td><span class="sym-cell">${svgFor(kinds[i])}<span>${r[0]}</span></span></td><td class="num">${r[1]}</td><td class="num">${r[2]}</td><td class="num">${r[3]}</td></tr>`;
  });
  return h + '</tbody></table></div>';
}

const root = document.getElementById('payoutTables');
root.innerHTML = `
  <div>
    <h3 style="color:var(--gold2);">Golden Charge</h3>
    ${table(D.a, ORDER_A)}
    <p class="hint" style="margin-top:8px;">Bull = wild. Ranch Gate: 3/4/5 pay ${D.scatterPay.join(' / ')} credits and start ${D.freeGames.join(' / ')} free games.</p>
  </div>
  <div>
    <h3 style="color:var(--gold2);">Thunder Herd</h3>
    ${table(D.b, ORDER_B)}
    <p class="hint" style="margin-top:8px;">${D.bTrigger}+ Money Bulls start Hold &amp; Respin. Grand pays ${D.bGrand.toLocaleString()} credits.</p>
  </div>
`;
