import icon from '../../resources/icon.svg?url';

export function SourcefieldIcon({ size = 24, className = '' }: { size?: number; className?: string }) {
  return <img src={icon} width={size} height={size}
    alt="" aria-hidden="true" draggable={false} className={`sourcefield-icon ${className}`} />;
}
