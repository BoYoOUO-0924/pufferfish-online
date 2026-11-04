/** 遊戲內規則說明（依 docs/規則規格書.md 摘要） */
import { CARD_COUNTS, LAYERS, type CardKind } from '@pufferfish/engine';
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

export function RulesDialog({ onClose }: { onClose: () => void }) {
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
          <ol>
            <li>從牌堆抽 1 張。抽到生氣的河豚時，手上有 Chill 就自動擋下，並把河豚偷偷放回牌堆任意位置；沒有 Chill 就淘汰。</li>
            <li>打出 1 次牌：單張生物（沒有效果）、功能牌、或組合技。</li>
          </ol>
          <p className="hint">功能牌和組合技打出後，大家有 4 秒可以用 No way 取消，被指定的人可以用 Pass 轉給下一位。</p>
        </section>

        <section>
          <h3>組合技（限同種生物）</h3>
          <ul>
            <li><strong>漁網（2 張）</strong>：拿走棄牌堆最上面那張。</li>
            <li><strong>漁販（3 張）</strong>：抽 5 張留 3 張，其餘依你排的順序放回牌堆頂。</li>
            <li><strong>魚雷（4 張）</strong>：從下一位開始輪流抽牌，第一個抽到河豚的人淘汰，Chill 無效。</li>
          </ul>
        </section>

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
          <p className="hint">空白鍵：抽牌／拍牌 · Enter：出牌 · N：No way · P：Pass · Esc：不回應</p>
        </section>
      </div>
    </div>
  );
}
