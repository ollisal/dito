import Vue from 'vue'
import escapeHtml from './utils/escapeHtml'
import renderLabel from './utils/renderLabel'

const components = {}
const types = {}

const BaseComponent = Vue.extend({
  // Make sure that registered components are present in all BaseComponent.
  components: components,

  methods: {
    typeToComponent(type) {
      return types[type]
    },

    renderLabel,
    escapeHtml
  }
})

BaseComponent.component = function(name, options) {
  const ctor = this.extend(options)
  components[name] = ctor
  return ctor
}

BaseComponent.types = types
BaseComponent.components = components

export default BaseComponent
