<template lang="pug">
  .dito-errors
    ul
      li(v-for="error in $errors.collect(dataPath)")
        | {{ error }}
</template>

<style lang="sass">
.dito
  .dito-errors
    position: absolute
    z-index: 1
    ul
      margin-top: 1px
      color: $color-error
</style>

<script>
import DitoComponent from '@/DitoComponent'

// @vue/component
export default DitoComponent.component('dito-errors', {
  inject: ['$validator'],

  props: {
    dataPath: { type: String, required: true }
  }
})
</script>
