<template lang="pug">
  .dito-panel
    ul.dito-list(v-if="desc.components")
      li(v-for="(comp, key) in desc.components")
        dito-label(v-if="comp.label", :name="key", :text="comp.label")
        component(:is="typeToComponent(comp.type)", :name="key", :desc="comp",
          :data="data", :meta="meta", :disabled="comp.disabled || disabled")
</template>

<script>
import DitoComponent from '@/DitoComponent'

export default DitoComponent.component('dito-panel', {
  props: {
    desc: { type: Object, required: true },
    data: { type: Object, required: true },
    meta: { type: Object, required: true },
    disabled: { type: Boolean, required: true }
  }
})
</script>