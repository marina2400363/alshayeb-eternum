import React, { useRef } from "react";
import { PHOTO_ACCEPT_ATTRIBUTE } from "../utils/photo";

// Choose / preview / replace the personal photo. Purely presentational: the
// provider validates, compresses and owns the preview URL. Nothing is
// uploaded from here.
//
// Visually this is the flow's hero moment: a tall editorial frame, the name
// set large over the photo, and a quiet text control to replace it.
export default function PhotoPicker({ previewUrl, caption, processing, error, disabled, onSelect, buttonRef }) {
  const inputRef = useRef(null);
  const hasPhoto = Boolean(previewUrl);
  const errorId = "photo-error";

  const handleChange = (event) => {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again (after an error) still fires.
    event.target.value = "";
    if (file) onSelect(file);
  };

  return (
    <div className="s2-ob-photo">
      <div className={`s2-ob-photo-frame ${hasPhoto ? "has-photo" : ""} ${error ? "is-error" : ""}`}>
        {hasPhoto ? (
          <>
            <img className="s2-ob-photo-img" src={previewUrl} alt="Preview of you" />
            {caption && (
              <span className="s2-ob-photo-caption" aria-hidden="true">
                {caption}
              </span>
            )}
          </>
        ) : (
          <div className="s2-ob-photo-empty">
            <span className="s2-ob-photo-empty-line">No photo</span> <span className="s2-ob-photo-empty-line">yet</span>
          </div>
        )}
        {processing && (
          <div className="s2-ob-photo-busy" role="status">
            <span className="s2-spinner" aria-hidden="true" />
            <span>Preparing your photo…</span>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        className="s2-ob-sr"
        type="file"
        accept={PHOTO_ACCEPT_ATTRIBUTE}
        onChange={handleChange}
        tabIndex={-1}
        aria-hidden="true"
      />

      <button
        ref={buttonRef}
        type="button"
        className="s2-ob-photo-btn"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || processing}
        aria-describedby={error ? errorId : undefined}
      >
        {hasPhoto ? "Replace photo" : "Choose photo"}
      </button>

      {error && (
        <p id={errorId} className="s2-ob-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
