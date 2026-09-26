// Small rendition of a customer's stored registration photo for the Admin
// details view.
//
// The photo is already on Cloudinary (uploaded once, at registration). A
// Cloudinary delivery URL looks like
//   https://res.cloudinary.com/<cloud>/image/upload/v123/<folder>/<file>.jpg
// and a transformation segment placed right after "/upload/" makes Cloudinary
// SERVE a small cropped rendition of that same stored image: nothing is
// uploaded, copied or re-processed, and the full-size original stays one click
// away (the panel links to the untouched URL). Any other URL is returned as-is.
const CLOUDINARY_VERSIONED_UPLOAD = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(v\d+\/.+)$/;

// `size` is the square edge (px) of the rendition Cloudinary serves. The
// default (160) is the details-panel photo; a table asks for less (a ~36px
// thumbnail needs ~72px at 2x density), keeping a page of rows tiny.
export function customerPhotoThumbUrl(url, size = 160) {
  if (!url || typeof url !== "string") return "";
  const match = url.match(CLOUDINARY_VERSIONED_UPLOAD);
  return match ? `${match[1]}c_fill,g_face,w_${size},h_${size},q_auto,f_auto/${match[2]}` : url;
}
