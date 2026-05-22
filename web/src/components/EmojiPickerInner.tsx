import EmojiPicker, { Theme, type EmojiClickData } from 'emoji-picker-react';

/**
 * Cat-2: the heavy `emoji-picker-react` dependency (~398 kB of source) lives
 * here in its own module so the parent can `React.lazy()` it. The picker only
 * renders when the user opens the popover, so it should never be in the initial
 * bundle. Default export is required by React.lazy.
 */
export default function EmojiPickerInner({
  onEmojiClick,
}: {
  onEmojiClick: (emoji: EmojiClickData) => void;
}) {
  return (
    <EmojiPicker
      onEmojiClick={onEmojiClick}
      skinTonesDisabled={true}
      theme={Theme.DARK}
      height={350}
      width={300}
      searchPlaceholder="Search emoji..."
      previewConfig={{ showPreview: false }}
    />
  );
}
