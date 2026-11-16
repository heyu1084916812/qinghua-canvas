import baseStyles from '../SettingsPage.module.css'
import settingsChannelListStyles from '../SettingsChannelList.module.css'
import settingsChannelListDetailsStyles from '../SettingsChannelListDetails.module.css'
import settingsRoutePolicyStyles from '../SettingsRoutePolicy.module.css'
import settingsChannelFormStyles from '../SettingsChannelForm.module.css'
import settingsChannelWorkspaceStyles from '../SettingsChannelWorkspace.module.css'
import settingsModelBindingStyles from '../SettingsModelBinding.module.css'
import settingsModelMappingStyles from '../SettingsModelMapping.module.css'
import settingsAppearanceSystemStyles from '../SettingsAppearanceSystem.module.css'

export const settingsPageStyles = {
  ...baseStyles,
  ...settingsChannelListStyles,
  ...settingsChannelListDetailsStyles,
  ...settingsRoutePolicyStyles,
  ...settingsChannelFormStyles,
  ...settingsChannelWorkspaceStyles,
  ...settingsModelBindingStyles,
  ...settingsModelMappingStyles,
  ...settingsAppearanceSystemStyles,
  // The facade composes both `.item` rules in CSS order; object spread would
  // otherwise replace it with only the later details-row override.
  item: baseStyles.item,
} as Record<string, string>
