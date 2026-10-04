<script setup lang="ts">
// Native <dialog> shell shared by settings / help / skills / credits. The root element is the dialog,
// so id and class set by the parent land on it and client.ts can still call showModal() by id.
defineProps<{ closeLabel: string; wide?: boolean }>();
</script>

<template>
  <dialog :class="['modal', { wide }]">
    <div class="modal-inner frame frame-lg">
      <header class="modal-head">
        <div class="modal-title"><slot name="head" /></div>
        <form method="dialog"><button class="dialog-close icon-btn frame frame-sm" :aria-label="closeLabel"><svg class="ui-ic" aria-hidden="true"><use href="#ui-close" /></svg></button></form>
      </header>
      <div class="modal-body"><slot /></div>
      <footer v-if="$slots.footer" class="modal-foot"><slot name="footer" /></footer>
    </div>
  </dialog>
</template>
