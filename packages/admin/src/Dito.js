import Vue from 'vue'
import VueRouter from 'vue-router'
import VeeValidate from 'vee-validate'
import './components'
import './types'
import TypeComponent from './TypeComponent'
import DitoRoot from './components/DitoRoot'
import { isFunction, hyphenate } from './utils'
import { processComponent } from './schema'

Vue.config.productionTip = false
Vue.use(VueRouter)
Vue.use(VeeValidate, {
  // See: https://github.com/logaretm/vee-validate/issues/468
  inject: false,
  // Prefix `errors` and `fields with $ to make it clear they're special props:
  errorBagName: '$errors',
  fieldsBagName: '$fields'
})

export async function setup(el, options = {}) {
  const {
    schemas = {},
    settings = {},
    api = {}
  } = options

  const { normalizePath } = api
  api.processPath = isFunction(normalizePath)
    ? normalizePath
    : normalizePath === true
      ? hyphenate
      : val => val

  api.resources = {
    member(component, itemId) {
      return `${component.listSchema.path}/${itemId}`
    },
    collection(component) {
      const { parentFormComponent: parent, listSchema } = component
      return parent
        ? `${parent.listSchema.path}/${parent.itemId}/${listSchema.path}`
        : listSchema.path
    },
    ...api.resources
  }

  // Collect all routes from the root schema components
  const routes = []
  const promises = []
  for (const [name, schema] of Object.entries(schemas)) {
    promises.push(processComponent(schema, name, api, routes, null, 0))
  }
  await Promise.all(promises)

  new Vue({
    el,
    router: new VueRouter({
      mode: 'history',
      routes
    }),
    template: '<dito-root :schemas="schemas" :settings="settings" />',
    components: { DitoRoot },
    data: {
      schemas,
      settings
    }
  })
}

export const { register } = TypeComponent

export default {
  setup,
  register
}
