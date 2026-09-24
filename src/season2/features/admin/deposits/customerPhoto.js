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
const THUMB_TRANSFORM = "c_fill,g_face,w_160,h_160,q_auto,f_auto/";

export function customerPhotoThumbUrl(url) {
  if (!url || typeof url !== "string") return "";
  const match = url.match(CLOUDINARY_VERSIONED_UPLOAD);
  return match ? `${match[1]}${THUMB_TRANSFORM}${match[2]}` : url;
}
