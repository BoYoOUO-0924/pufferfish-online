/** 遊戲內規則說明（依 docs/規則規格書.md 摘要） */
import { CARD_COUNTS, LAYERS, type CardKind, type Variant } from '@pufferfish/engine';
import { CARD_HELP, cardName } from '../cards';
import { CardView } from './CardView';

const FUNCTION_ORDER: CardKind[] = [
  'puffer',
  'chill',
  'noway',
  'pass',
  'steal',
  'salmon',
  'switch',
  'chef',
  'wave',
  'reverse',
  'watchout',
];

export function RulesDialog({ onClose, variant = 'classic' }: { onClose: () => void; variant?: Variant }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal rules" role="dialog" aria-label="遊戲規則" onClick={(e) => e.stopPropagation()}>
        <header className="rules-head">
          <h2>遊戲規則</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </header>

        <section>
          <h3>怎麼贏</h3>
          <ul>
            <li>其他人都被生氣的河豚淘汰，剩你一個。</li>
            <li>或在自己回合，一次打出<strong>同一海洋層的 5 種生物</strong>各 1 張（不能被 No way 擋）。</li>
          </ul>
        </section>

        <section>
          <h3>每回合</h3>
          {variant === 'deep' ? (
            <ol>
              <li>先出牌：至少打出 1 次（單張生物、功能牌或組合技），之後可以繼續出，想停就按「結束出牌」。手上沒有能出的牌就直接抽牌。</li>
              <li>再抽 1 張，抽完回合結束。抽到生氣的河豚時，手上有 Chill 就自動擋下並把河豚偷偷放回牌堆；沒有 Chill 就淘汰。</li>
            </ol>
          ) : (
            <ol>
              <li>從牌堆抽 1 張。抽到生氣的河豚時，手上有 Chill 就自動擋下，並把河豚偷偷放回牌堆任意位置；沒有 Chill 就淘汰。用 Chill 擋下後回合直接結束，不用出牌。</li>
              <li>打出 1 次牌：單張生物（沒有效果）、功能牌、或組合技。</li>
            </ol>
          )}
          <p className="hint">功能牌和組合技打出後，大家有 6 秒可以用 No way 取消，被指定的人可以用 Pass 轉給下一位。</p>
        </section>

        {variant === 'deep' ? (
          <>
            <section className="rules-variant">
              <h3>深海變體：單張生物</h3>
              <ul>
                <li><strong>淺海生物「浮潛」</strong>：偷看牌堆頂 1 張（只有你看到，只看不動）。看到河豚就可以接著出別的牌躲開。</li>
                <li><strong>深海生物「深潛」</strong>：這回合出完牌後，改從牌堆底抽。</li>
              </ul>
              <p className="hint">單張生物不開回應時間，不能被 No way。你看過的牌堆頂會顯示在牌堆上方，直到牌堆被動到為止。</p>
            </section>
            <section className="rules-variant">
              <h3>深海變體：組合技</h3>
              <ul>
                <li><strong>拖網（同種 2 張）</strong>：拿走棄牌堆最上面那張。</li>
                <li><strong>魚雷（同種 3 張）</strong>：從下一位開始輪流抽牌，第一個抽到河豚的人淘汰，Chill 無效。打出魚雷的人這回合不用抽牌。</li>
                <li><strong>聲納（同一海洋層 3 種不同）</strong>：看牌堆頂 4 張，任意重新排列後放回。</li>
                <li><strong>收集勝利（同一海洋層 5 種不同）</strong>：直接獲勝。</li>
              </ul>
              <p className="hint">Wave 在深海變體只把牌堆重新洗牌，棄牌堆不洗回去。</p>
            </section>
          </>
        ) : (
          <section>
            <h3>組合技（限同種生物）</h3>
            <ul>
              <li><strong>漁網（2 張）</strong>：拿走棄牌堆最上面那張。</li>
              <li><strong>漁販（3 張）</strong>：抽 5 張留 3 張，其餘依你排的順序放回牌堆頂。</li>
              <li><strong>魚雷（4 張）</strong>：從下一位開始輪流抽牌，第一個抽到河豚的人淘汰，Chill 無效。</li>
            </ul>
          </section>
        )}

        <section>
          <h3>海洋生物（每種 4 張）</h3>
          {Object.entries(LAYERS).map(([layer, species]) => (
            <div key={layer} className="rules-row">
              <span className="rules-layer">{layer === 'shallow' ? '淺海' : '深海'}</span>
              <div className="rules-cards">
                {species.map((k) => (
                  <figure key={k}>
                    <CardView kind={k} size="sm" />
                    <figcaption>{cardName(k)}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section>
          <h3>特殊與功能牌</h3>
          <ul className="rules-functions">
            {FUNCTION_ORDER.map((k) => (
              <li key={k}>
                <CardView kind={k} size="sm" />
                <div>
                  <strong>
                    {cardName(k)} ×{CARD_COUNTS[k]}
                  </strong>
                  <span>{CARD_HELP[k]}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3>快捷鍵（電腦）</h3>
          <p className="hint">空白鍵：抽牌／拍牌 · Enter：出牌 · E：結束出牌（深海變體） · N：No way · P：Pass · Esc：不回應</p>
        </section>
      </div>
    </div>
  );
}
