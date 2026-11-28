export const CLOCK_FONTS = ['Inter', 'Roboto', 'Poppins', 'Montserrat', 'Nunito Sans',
    'DM Sans', 'Manrope', 'Outfit', 'Space Grotesk', 'Plus Jakarta Sans'];

// Only known bundled family names may enter St CSS or Pango descriptions.
export function clockFont(value) {
    return CLOCK_FONTS.includes(value) ? value : '';
}
