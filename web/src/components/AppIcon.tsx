export function AppIcon({ iconUrl, name }: { iconUrl?: string; name: string }) {
  if (iconUrl) return <img className="icon" src={iconUrl} alt="" />;
  return (
    <svg className="icon" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#6b7280" />
      <text x="32" y="42" textAnchor="middle" fontSize="30" fontWeight="700" fill="#fff">{name.charAt(0).toUpperCase()}</text>
    </svg>
  );
}
