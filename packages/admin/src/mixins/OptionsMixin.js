import axios from 'axios'
import { isObject, isArray, isFunction, getDataPath } from '@ditojs/utils'
import LoadingMixin from './LoadingMixin'

export default {
  mixins: [LoadingMixin],

  data() {
    return {
      loadedOptions: null
    }
  },

  created() {
    this.loadOptions(this.schema.options)
  },

  watch: {
    'schema.options': 'loadOptions'
  },

  computed: {
    options() {
      if (this.loadedOptions) {
        return this.loadedOptions
      }
      const { options } = this.schema
      let data = null
      if (isObject(options)) {
        if (options.dataPath) {
          // dataPath uses the json-pointer format to reference data in the
          // dataFormComponent, meaning the first parent data that isn't nested.
          const getAtPath = (data, path) => data && getDataPath(data, path)
          const { dataPath } = options
          data = /^[./]/.test(dataPath)
            ? getAtPath(this.dataFormComponent?.data, dataPath.substr(1))
            : getAtPath(this.data, dataPath)
          if (this.relate) {
            // If ids are missing and we want to relate, add temporary ids,
            // marked it with a '@' at the beginning.
            if (data) {
              for (const option of data) {
                if (!option.id) {
                  option.id = `@${++temporaryId}`
                }
              }
            }
          }
        } else {
          const { values } = options
          data = isFunction(values)
            ? values.call(this, this.data)
            : values
        }
      } else {
        data = options
      }
      return this.processOptions(data)
    },

    selectValue: {
      get() {
        return this.relate
          ? this.optionToValue(this.value)
          : this.value
      },
      set(value) {
        this.value = this.relate
          ? this.valueToOption(value)
          : value
      }
    },

    groupBy() {
      return this.schema.options.groupBy
    },

    relate() {
      return this.schema.options.relate
    },

    optionLabelKey() {
      // If no labelKey was provided but the options are objects, assume a
      // default value of 'label':
      return this.schema.options.labelKey ||
        isObject(this.options?.[0]) && 'label' ||
        null
    },

    optionValueKey() {
      // If no valueKey was provided but the options are objects, assume a
      // default value of 'value':
      return this.schema.options.valueKey ||
        this.relate && 'id' ||
        isObject(this.options?.[0]) && 'value' ||
        null
    },

    groupLabelKey() {
      return this.groupBy && 'name' || null
    },

    groupOptionsKey() {
      return this.groupBy && 'options' || null
    }
  },

  methods: {
    loadOptions(options) {
      if (isObject(options)) {
        const url = options.url ||
          options.apiPath && this.api.url + options.apiPath
        if (url) {
          this.setLoading(true)
          this.loadedOptions = null
          axios.get(url)
            .then(response => {
              setTimeout(() => {
                this.setLoading(false)
                this.loadedOptions = this.processOptions(response.data)
              }, 1000)
            })
            .catch(error => {
              this.setLoading(false)
              this.$errors.add(this.name, error.response?.data || error.message)
              return null
            })
        }
      }
    },

    getOptionValue(option) {
      return this.optionValueKey ? option[this.optionValueKey] : option
    },

    getOptionLabel(option) {
      return this.optionLabelKey ? option[this.optionLabelKey] : option
    },

    processOptions(options) {
      if (!isArray(options)) {
        return []
      }
      if (this.groupBy) {
        options = this.groupOptions(options)
      }
      if (this.relate) {
        // Inject a non-enumerable $relate property so processPayload() can
        // remove everything except the id for relates, and generate correct
        // #ref / #id values for temporary ids.
        options = this.mapOptions(options, option =>
          Object.defineProperty({ ...option }, '$relate', {
            enumerable: false,
            configurable: true,
            writeable: true,
            value: true
          })
        )
      }
      return options
    },

    groupOptions(options) {
      const grouped = {}
      return options.reduce((results, option) => {
        const name = option[this.groupBy]
        let entry = grouped[name]
        if (!entry) {
          entry = grouped[name] = {
            [this.groupLabelKey]: name,
            [this.groupOptionsKey]: []
          }
          results.push(entry)
        }
        entry.options.push(option)
        return results
      }, [])
    },

    findOption(options, value, groupBy = this.groupBy) {
      // Search for the option object with the given value and return the
      // whole object.
      for (const option of options) {
        if (groupBy) {
          const found = this.findOption(option.options, value, null)
          if (found) {
            return found
          }
        } else if (value === this.getOptionValue(option)) {
          return option
        }
      }
    },

    mapOptions(options, callback, groupBy = this.groupBy) {
      if (groupBy) {
        return options.map(group => ({
          ...group,
          [this.groupOptionsKey]: this.mapOptions(
            group[this.groupOptionsKey], callback, null
          )
        }))
      } else {
        return options.map(option => callback(option))
      }
    },

    valueToOption(value) {
      return this.optionValueKey
        ? this.findOption(this.options, value)
        : value
    },

    optionToValue(value) {
      // When changes happen, store the mapped value instead of full object.
      return this.optionValueKey
        ? value?.[this.optionValueKey]
        : value
    }
  }
}

let temporaryId = 0
