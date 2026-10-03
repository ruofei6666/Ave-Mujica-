<script setup lang="ts">
// One inline sprite for the whole UI. ic-* ids are referenced by client.ts for skill buttons
// (swapped per character); ui-* ids are interface glyphs. All are 24x24, stroke-drawn with
// currentColor; the .ic/.ui-ic classes in kit.css set the stroke style.
</script>
<template>
  <svg class="sprite" width="0" height="0" aria-hidden="true" focusable="false">
    <defs>
      <!-- skill glyphs -->
      <symbol id="ic-fist" viewBox="0 0 24 24"><path d="M12 2l2.2 6.3L21 6l-3.3 6.1L22 16l-6.6-.6L12 22l-3.4-6.6L2 16l4.3-3.9L3 6l6.8 2.3z"/></symbol>
      <symbol id="ic-curtain" viewBox="0 0 24 24"><path d="M3 4c4 1 6 6 6 8s-2 7-6 8M21 4c-4 1-6 6-6 8s2 7 6 8M12 6v12"/></symbol>
      <symbol id="ic-note" viewBox="0 0 24 24"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></symbol>
      <symbol id="ic-wave" viewBox="0 0 24 24"><path d="M2 16c3-9 6-9 10 0 2-5 5-6 10-2M2 21h20"/></symbol>
      <symbol id="ic-meteor" viewBox="0 0 24 24"><circle cx="8" cy="16" r="4.5"/><path d="M12 12L21 3M14.5 16.5L21 10M7.5 11.5L12 7"/></symbol>
      <symbol id="ic-string" viewBox="0 0 24 24"><path d="M5 3v7l4 2-3 3 4 2v5M19 3v18M15 8h8"/></symbol>
      <symbol id="ic-mask" viewBox="0 0 24 24"><path d="M3 9c3-3 6-3 9-1 3-2 6-2 9 1-1 6-4 8-7 6l-2-1-2 1c-3 2-6 0-7-6z"/><path d="M7 11h3M14 11h3"/></symbol>
      <symbol id="ic-shadow" viewBox="0 0 24 24"><path d="M6 21V10a6 6 0 1112 0v11l-3-2-3 2-3-2z"/><path d="M9.5 10h.01M14.5 10h.01"/></symbol>
      <symbol id="ic-cross" viewBox="0 0 24 24"><path d="M4 4l16 16M20 4L4 20M12 1v4M12 19v4"/></symbol>
      <symbol id="ic-scissors" viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 7.5L21 19M8.5 16.5L21 5"/></symbol>
      <symbol id="ic-dash" viewBox="0 0 24 24"><path d="M3 7h9M1 12h13M3 17h9M15 5l7 7-7 7"/></symbol>
      <symbol id="ic-slash3" viewBox="0 0 24 24"><path d="M5 4l7 16M10 3l8 17M15 4l6 14"/></symbol>
      <symbol id="ic-bolt" viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></symbol>
      <symbol id="ic-camera" viewBox="0 0 24 24"><path d="M3 7h4l2-3h6l2 3h4v13H3z"/><circle cx="12" cy="13" r="4"/></symbol>
      <symbol id="ic-shield" viewBox="0 0 24 24"><path d="M12 2l8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5z"/></symbol>
      <symbol id="ic-flame" viewBox="0 0 24 24"><path d="M12 2c1 4 6 6 6 12a6 6 0 11-12 0c0-3 2-4 3-7 1 2 2 2 3-5z"/></symbol>
      <symbol id="ic-quake" viewBox="0 0 24 24"><path d="M2 20l6-5-2-4 6-2-1-5 6 5-3 2 7 2M2 22h20"/></symbol>
      <symbol id="ic-ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/></symbol>
      <symbol id="ic-slash2" viewBox="0 0 24 24"><path d="M3 6l18 5M3 18l18-5M7 12h10"/></symbol>
      <symbol id="ic-pillars" viewBox="0 0 24 24"><path d="M4 22V12h4v10M10 22V4h4v18M16 22V9h4v13"/></symbol>

      <!-- interface glyphs -->
      <symbol id="ui-help" viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M9.6 9.6a2.5 2.5 0 114 2c-.9.6-1.6 1-1.6 2.2M12 16.6v.01"/></symbol>
      <symbol id="ui-sliders" viewBox="0 0 24 24"><path d="M3 7h10M17 7h4M3 12h4M11 12h10M3 17h12M19 17h2"/><path d="M15 4.5v5M9 9.5v5M17 14.5v5"/></symbol>
      <symbol id="ui-pause" viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none"/></symbol>
      <symbol id="ui-close" viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></symbol>
      <symbol id="ui-chevrons" viewBox="0 0 24 24"><path d="M4 5l7 7-7 7M12 5l7 7-7 7"/></symbol>
      <symbol id="ui-arrow" viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6"/></symbol>
      <symbol id="ui-plus" viewBox="0 0 24 24"><path d="M12 4v16M4 12h16"/></symbol>
      <symbol id="ui-copy" viewBox="0 0 24 24"><path d="M9 9h11v11H9zM5 15V4h11"/></symbol>
      <symbol id="ui-install" viewBox="0 0 24 24"><path d="M12 3v12M7 11l5 5 5-5M4 20h16"/></symbol>
      <symbol id="ui-rotate" viewBox="0 0 24 24"><path d="M20 12a8 8 0 11-2.6-5.9M20 3.5V9h-5.5"/></symbol>
      <symbol id="ui-play" viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/></symbol>
      <!-- fallback mark, used until the generated emblem is delivered -->
      <symbol id="ui-emblem" viewBox="0 0 24 24"><path d="M12 1.5l9 5.2v10.6l-9 5.2-9-5.2V6.7z"/><path d="M15.2 7.4a5.2 5.2 0 100 9.2 4.2 4.2 0 010-9.2z"/><path d="M12 2.4v2.6"/></symbol>
    </defs>
  </svg>
</template>
