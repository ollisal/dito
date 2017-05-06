import isObject from 'isobject'
import axios from 'axios'

export default {
  data() {
    return {
      options: [],
      // TODO: Allow handling through RouteMixin if required...
      loading: false
    }
  },

  created() {
    const options = this.desc.options
    if (isObject(options)) {
      if (options.url) {
        this.loading = true
        axios.get(options.url)
          .then(response => {
            this.loading = false
            this.options = options.groupBy
                ? this.groupBy(response.data, options.groupBy)
                : response.data
          })
          .catch(error => {
            this.errors.add(this.name,
                error.response && error.response.data || error.message)
            this.options = null
            this.loading = false
          })
      } else {
        // When providing options.labelKey & options.valueKey, options.values
        // can be used to provide the data instead of options.url
        this.options = options.values
      }
    } else if (Array.isArray(options)) {
      // Use an array of strings to provide the values be shown and selected.
      this.options = options
    }
  },

  computed: {
    labelKey() {
      // If no labelKey was provided but the options are objects, assume a
      // default value of 'label':
      return this.desc.options.labelKey ||
          this.options && isObject(this.options[0]) && 'label' || null
    },

    valueKey() {
      // If no valueKey was provided but the options are objects, assume a
      // default value of 'value':
      return this.desc.options.valueKey ||
          this.options && isObject(this.options[0]) && 'value' || null
    },

    groupLabelKey() {
      return this.desc.options.groupBy && 'name' || null
    },

    groupOptionsKey() {
      return this.desc.options.groupBy && 'options' || null
    }
  },

  methods: {
    getValue(option) {
      return this.valueKey ? option[this.valueKey] : option
    },

    getLabel(option) {
      return this.labelKey ? option[this.labelKey] : option
    },

    groupBy(options, groupBy) {
      const grouped = {}
      return options.reduce(function(results, option) {
        const name = option[groupBy]
        let entry = grouped[name]
        if (!entry) {
          entry = grouped[name] = {
            name: name, // :group-label, see groupLabelKey()
            options: [] // :group-values, see groupOptionsKey()
          }
          results.push(entry)
        }
        entry.options.push(option)
        return results
      }, [])
    },

    findOption(options, value, groupBy) {
      // Search for the option object with the given value and return the
      // whole object.
      if (options) {
        for (let option of options) {
          if (groupBy) {
            const found = this.findOption(option.options, value, false)
            if (found) {
              return found
            }
          } else if (value === option[this.valueKey]) {
            return option
          }
        }
      }
    }
  }
}