import baseStyles from '../EcommerceStudio.module.css'
import formStyles from './EcommerceStudioForms.module.css'
import intentStyles from './EcommerceStudioFormsIntent.module.css'
import planStyles from './EcommerceStudioFormsPlan.module.css'
import personStyles from './EcommerceStudioFormsPerson.module.css'
import statusStyles from './EcommerceStudioStatus.module.css'
import resultsStyles from './EcommerceStudioResults.module.css'
import overlaysStyles from './EcommerceStudioOverlays.module.css'

export const styles = {
  ...baseStyles,
  ...formStyles,
  ...intentStyles,
  ...planStyles,
  ...personStyles,
  ...statusStyles,
  ...resultsStyles,
  ...overlaysStyles,
}

export type StudioStyles = typeof styles
