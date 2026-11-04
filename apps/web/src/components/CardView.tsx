import type { CardKind } from '@pufferfish/engine';
import { CARD_HELP, cardImg, cardName } from '../cards';

interface Props {
  kind: CardKind | 'back';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  selected?: boolean;
  disabled?: boolean;
  badge?: string;
  onClick?: () => void;
}

export function CardView({ kind, size = 'md', selected, disabled, badge, onClick }: Props) {
  const label = kind === 'back' ? '牌背' : cardName(kind);
  const title = kind === 'back' ? undefined : `${label}：${CARD_HELP[kind]}`;
  const cls = `card card-${size}${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}${onClick ? ' clickable' : ''}`;
  const inner = (
    <>
      <img src={cardImg(kind)} alt={label} draggable={false} />
      {badge && <span className="card-badge">{badge}</span>}
    </>
  );
  return onClick ? (
    <button type="button" className={cls} title={title} onClick={onClick} disabled={disabled} aria-pressed={selected}>
      {inner}
    </button>
  ) : (
    <div className={cls} title={title}>
      {inner}
    </div>
  );
}
