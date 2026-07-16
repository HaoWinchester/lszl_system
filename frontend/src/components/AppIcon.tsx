import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock3,
  Download,
  Folder,
  FolderPlus,
  Grid2X2,
  House,
  List,
  LogOut,
  MoreHorizontal,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Sun,
  Trash2,
  Upload,
  User,
  UserPlus,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from 'lucide-react'

const appIcons = {
  add: Plus,
  back: ArrowLeft,
  search: Search,
  settings: Settings,
  refresh: RefreshCw,
  grid: Grid2X2,
  list: List,
  more: MoreHorizontal,
  delete: Trash2,
  upload: Upload,
  download: Download,
  folder: Folder,
  user: User,
  logout: LogOut,
  close: X,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  check: Check,
  chevronDown: ChevronDown,
  collapse: PanelLeftClose,
  expand: PanelLeftOpen,
  recent: Clock3,
  favorite: Star,
  folderAdd: FolderPlus,
  sun: Sun,
  moon: Moon,
  home: House,
  userAdd: UserPlus,
  network: Network,
} satisfies Record<string, LucideIcon>

export type AppIconName = keyof typeof appIcons
export type AppIconSize = 'compact' | 'default' | 'prominent'

type AppIconProps = {
  name: AppIconName
  size?: AppIconSize
  label?: string
  className?: string
}

export function AppIcon({ name, size = 'default', label, className }: AppIconProps) {
  const Icon = appIcons[name]

  return (
    <Icon
      className={['kg-icon', `kg-icon--${size}`, className].filter(Boolean).join(' ')}
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      focusable="false"
    />
  )
}
