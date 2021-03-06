import ItemMixin from './ItemMixin'
import LoadingMixin from './LoadingMixin'
import { setDefaults } from '@/utils/schema'
import { isString, labelize } from '@ditojs/utils'

// @vue/component
export default {
  mixins: [ItemMixin, LoadingMixin],

  provide() {
    return {
      // Pass local verbs overrides on to children, see verbs()
      $verbs: this.verbs
    }
  },

  data() {
    return {
      loadedData: null
    }
  },

  computed: {
    isNested() {
      return !!this.sourceSchema.nested
    },

    isExcluded() {
      return !!this.sourceSchema.exclude
    },

    isTransient() {
      // Check the form that this component belongs to as well, since it may be
      // in creation mode, which makes it transient.
      // NOTE: This does not loop endlessly because DitoForm redefines
      // `isTransient()` to only return `this.isNested`.
      const form = this.formComponent
      return (
        this.isNested ||
        this.isExcluded ||
        form && (
          form.isTransient ||
          form.create
        )
      )
    },

    shouldLoad() {
      // If the parent data-component (view, form) that this list belongs to
      // also loads data, depend on this first.
      const parent = this.parentDataComponent
      return (
        !this.isTransient &&
        !this.isLoading && !(
          parent && (
            parent.shouldLoad ||
            parent.isLoading
          )
        )
      )
    },

    hasData() {
      return !!this.data
    },

    parentDataComponent() {
      // Used by `shouldLoad()`: Returns the parent `dataRouteComponent` that
      // may load data for this component. We need to use
      // `parentDataRouteComponent` here to get to the actual parent, as `this
      // === this.dataRouteComponent` if `this` is a route component:
      return this.parentDataRouteComponent
    },

    verbs() {
      // The actual code is the `getVerbs()` method, for easier overriding of
      // this computed property in components that use the DataMixin.
      return this.getVerbs()
    }
  },

  created() {
    if (!this.isNested) {
      this.setupData()
    }
  },

  methods: {
    getVerbs() {
      return this.isTransient
        ? {
          ...this.$verbs,
          // Override default verbs with their transient versions:
          create: 'add',
          created: 'added',
          save: 'apply',
          saved: 'applied',
          delete: 'remove',
          deleted: 'removed'
        }
        : this.$verbs
    },

    getResourcePath(resource) {
      const { type, id, path } = resource
      const url = this.api.resources[type](this, id)
      return path
        ? /^\//.test(path) ? path : `${url}/${path}`
        : url
    },

    findItemIdIndex(data, itemId) {
      const index = this.isTransient
        // For transient data, the index is used as the id
        ? itemId
        : data?.findIndex(
          (item, index) =>
            this.getItemId(this.sourceSchema, item, index) === itemId
        )
      return index !== -1 ? index : null
    },

    // @override
    clearData() {
      this.loadedData = null
    },

    // @override
    setData(data) {
      this.loadedData = data
    },

    setupData() {
      // Actual code is in separate function so it's easer to override
      // `setupData()` and and call `ensureData()` from the overrides,
      // see DitoForm and SourceMixin.
      this.ensureData()
    },

    ensureData() {
      if (this.shouldLoad) {
        if (this.hasData) {
          this.reloadData()
        } else {
          this.loadData(true)
        }
      }
    },

    reloadData() {
      if (!this.isTransient) {
        this.loadData(false)
      }
    },

    loadData(clear) {
      if (!this.isTransient) {
        if (clear) {
          this.clearData()
        }
        this.requestData()
      }
    },

    createData(schema, type) {
      return setDefaults(schema, type ? { type } : {})
    },

    requestData() {
      const params = this.getQueryParams()
      this.request('get', { params }, (err, response) => {
        if (err) {
          if (response) {
            const { data } = response
            if (data?.type === 'FilterValidation' && this.onFilterErrors) {
              this.onFilterErrors(data.errors)
              return true
            } else if (this.isUnauthorizedError(response)) {
              // TODO: Can we really swallow these errors?
              // Is calling `ensureUser()` in `onBeforeRequest()` enough?
              return true
            }
          }
        } else {
          this.setData(response.data)
        }
      })
    },

    isValidationError(response) {
      return response?.status === 400
    },

    isUnauthorizedError(response) {
      return response?.status === 401
    },

    async request(method, options, callback) {
      const { resource, payload: data, params } = options
      const url = this.getResourcePath(resource || this.resource)
      this.setLoading(true)
      const request = { method, url, data, params }
      try {
        await this.rootComponent.onBeforeRequest(request)
        const response = await this.api.request(request)
        await this.rootComponent.onAfterRequest(request)
        callback?.(null, response)
      } catch (error) {
        // If callback returns true, errors were already handled.
        const { response } = error
        if (!callback?.(error, response)) {
          const data = response?.data
          if (data && isString(data.type)) {
            this.notify('error', labelize(data.type), data.message || error)
          } else {
            this.notify('error', 'Request Error', error)
          }
        }
      }
      this.setLoading(false)
    },

    // @ditojs/server specific processing of parameters, payload and response:
    getQueryParams() {
      // @ditojs/server specific query parameters:
      // TODO: Consider moving this into a modular place, so other backends
      // could plug in as well.
      const { paginate } = this.sourceSchema
      const { page = 0, ...query } = this.query || {}
      const limit = this.isListSource && paginate // Only apply ranges on lists.
      const offset = page * limit
      return {
        ...query, // Query may override scope.
        // Convert offset/limit to range so that we get results counting:
        ...(limit && {
          range: `${offset},${offset + limit - 1}`
        })
      }
    }
  }
}
