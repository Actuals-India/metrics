(ns metabase.models.field
  (:require (clojure [data :as d]
                     [string :as s])
            [metabase.config :as config]
            [metabase.db :as db]
            (metabase.models [field-values :refer [FieldValues]]
                             [humanization :as humanization]
                             [interface :as i])
            [metabase.util :as u]))


;;; ------------------------------------------------------------ Type Mappings ------------------------------------------------------------

(def ^:const special-types
  "Possible values for `Field.special_type`."
  #{:avatar
    :category
    :city
    :country
    :desc
    :fk
    :id
    :image
    :json
    :latitude
    :longitude
    :name
    :number
    :state
    :timestamp_milliseconds
    :timestamp_seconds
    :url
    :zip_code})

(def ^:const base-types
  "Possible values for `Field.base_type`."
  #{:ArrayField
    :BigIntegerField
    :BooleanField
    :CharField
    :DateField
    :DateTimeField
    :DecimalField
    :DictionaryField
    :FloatField
    :IntegerField
    :TextField
    :TimeField
    :UUIDField      ; e.g. a Postgres 'UUID' column
    :UnknownField})

(def ^:const visibility-types
  "Possible values for `Field.visibility_type`."
  #{:normal         ; Default setting.  field has no visibility restrictions.
    :details-only   ; For long blob like columns such as JSON.  field is not shown in some places on the frontend.
    :hidden         ; Lightweight hiding which removes field as a choice in most of the UI.  should still be returned in queries.
    :sensitive      ; Strict removal of field from all places except data model listing.  queries should error if someone attempts to access.
    :retired})      ; For fields that no longer exist in the physical db.  automatically set by Metabase.  QP should error if encountered in a query.


(def ^:const special-type->valid-base-types
  "Map of special types to set of base types that are allowed to have that special type.
   Special types not included in this map can be applied to any base type."
  (let [numeric-base-types #{:BigIntegerField :DecimalField :FloatField :IntegerField}]
    {:timestamp_seconds      numeric-base-types
     :timestamp_milliseconds numeric-base-types}))

(defn valid-special-type-for-base-type?
  "Can SPECIAL-TYPE be used for this BASE-TYPE?"
  ^Boolean [special-type base-type]
  (let [valid-base-types (special-type->valid-base-types (keyword special-type))]
    (or (not valid-base-types)
        (contains? valid-base-types (keyword base-type)))))



;;; ------------------------------------------------------------ Entity & Lifecycle ------------------------------------------------------------

(i/defentity Field :metabase_field)

(defn- assert-valid-special-type [{special-type :special_type}]
  (when special-type
    (assert (contains? special-types (keyword special-type))
      (str "Invalid special type: " special-type))))

(defn- pre-insert [field]
  (assert-valid-special-type field)
  (let [defaults {:display_name (humanization/name->human-readable-name (:name field))}]
    (merge defaults field)))

(defn- pre-update [field]
  (u/prog1 field
    (assert-valid-special-type field)))

(defn- pre-cascade-delete [{:keys [id]}]
  (db/cascade-delete! Field :parent_id id)
  (db/cascade-delete! 'FieldValues :field_id id)
  (db/cascade-delete! 'MetricImportantField :field_id id))

(u/strict-extend (class Field)
  i/IEntity (merge i/IEntityDefaults
                   {:hydration-keys     (constantly [:destination :field :origin])
                    :types              (constantly {:base_type       :keyword
                                                     :special_type    :keyword
                                                     :visibility_type :keyword
                                                     :description     :clob})
                    :timestamped?       (constantly true)
                    :can-read?          (constantly true)
                    :can-write?         i/superuser?
                    :pre-insert         pre-insert
                    :pre-update         pre-update
                    :pre-cascade-delete pre-cascade-delete}))


;;; ------------------------------------------------------------ Hydration / Util Fns ------------------------------------------------------------


(defn target
  "Return the FK target `Field` that this `Field` points to."
  [{:keys [special_type fk_target_field_id]}]
  (when (and (= :fk special_type)
             fk_target_field_id)
    (Field fk_target_field_id)))

(defn values
  "Return the `FieldValues` associated with this FIELD."
  [{:keys [id]}]
  (db/select [FieldValues :field_id :values], :field_id id))

(defn with-values
  "Efficiently hydrate the `FieldValues` for a collection of FIELDS."
  {:batched-hydrate :values}
  [fields]
  (let [field-ids        (set (map :id fields))
        id->field-values (u/key-by :field_id (when (seq field-ids)
                                               (db/select FieldValues :field_id [:in field-ids])))]
    (for [field fields]
      (assoc field :values (get id->field-values (:id field) [])))))

(defn with-targets
  "Efficiently hydrate the FK target fields for a collection of FIELDS."
  {:batched-hydrate :target}
  [fields]
  (let [target-field-ids (set (for [field fields
                                    :when (and (= :fk (:special_type field))
                                               (:fk_target_field_id field))]
                                (:fk_target_field_id field)))
        id->target-field (u/key-by :id (when (seq target-field-ids)
                                         (db/select Field :id [:in target-field-ids])))]
    (for [field fields
          :let  [target-id (:fk_target_field_id field)]]
      (assoc field :target (id->target-field target-id)))))


(defn qualified-name-components
  "Return the pieces that represent a path to FIELD, of the form `[table-name parent-fields-name* field-name]`."
  [{field-name :name, table-id :table_id, parent-id :parent_id}]
  (conj (vec (if-let [parent (Field parent-id)]
               (qualified-name-components parent)
               (let [{table-name :name, schema :schema} (db/select-one ['Table :name :schema], :id table-id)]
                 (conj (when schema
                         [schema])
                       table-name))))
        field-name))

(defn qualified-name
  "Return a combined qualified name for FIELD, e.g. `table_name.parent_field_name.field_name`."
  [field]
  (s/join \. (qualified-name-components field)))

(defn table
  "Return the `Table` associated with this `Field`."
  {:arglists '([field])}
  [{:keys [table_id]}]
  (db/select-one 'Table, :id table_id))


;;; ------------------------------------------------------------ Sync Util Type Inference Fns ------------------------------------------------------------

(def ^:private ^:const pattern+base-types+special-type
  "Tuples of `[name-pattern set-of-valid-base-types special-type]`.
   Fields whose name matches the pattern and one of the base types should be given the special type.

   *  Convert field name to lowercase before matching against a pattern
   *  Consider a nil set-of-valid-base-types to mean \"match any base type\""
  (let [bool-or-int #{:BooleanField :BigIntegerField :IntegerField}
        float       #{:DecimalField :FloatField}
        int-or-text #{:BigIntegerField :IntegerField :CharField :TextField}
        text        #{:CharField :TextField}]
    [[#"^.*_lat$"       float       :latitude]
     [#"^.*_lon$"       float       :longitude]
     [#"^.*_lng$"       float       :longitude]
     [#"^.*_long$"      float       :longitude]
     [#"^.*_longitude$" float       :longitude]
     [#"^.*_rating$"    int-or-text :category]
     [#"^.*_type$"      int-or-text :category]
     [#"^.*_url$"       text        :url]
     [#"^_latitude$"    float       :latitude]
     [#"^active$"       bool-or-int :category]
     [#"^city$"         text        :city]
     [#"^country$"      text        :country]
     [#"^countryCode$"  text        :country]
     [#"^currency$"     int-or-text :category]
     [#"^first_name$"   text        :name]
     [#"^full_name$"    text        :name]
     [#"^gender$"       int-or-text :category]
     [#"^last_name$"    text        :name]
     [#"^lat$"          float       :latitude]
     [#"^latitude$"     float       :latitude]
     [#"^lon$"          float       :longitude]
     [#"^lng$"          float       :longitude]
     [#"^long$"         float       :longitude]
     [#"^longitude$"    float       :longitude]
     [#"^name$"         text        :name]
     [#"^postalCode$"   int-or-text :zip_code]
     [#"^postal_code$"  int-or-text :zip_code]
     [#"^rating$"       int-or-text :category]
     [#"^role$"         int-or-text :category]
     [#"^sex$"          int-or-text :category]
     [#"^state$"        text        :state]
     [#"^status$"       int-or-text :category]
     [#"^type$"         int-or-text :category]
     [#"^url$"          text        :url]
     [#"^zip_code$"     int-or-text :zip_code]
     [#"^zipcode$"      int-or-text :zip_code]]))

;; Check that all the pattern tuples are valid
(when-not config/is-prod?
  (doseq [[name-pattern base-types special-type] pattern+base-types+special-type]
    (assert (instance? java.util.regex.Pattern name-pattern))
    (assert (every? (partial contains? base-types) base-types))
    (assert (contains? special-types special-type))))

(defn- infer-field-special-type
  "If `name` and `base-type` matches a known pattern, return the `special_type` we should assign to it."
  [field-name base-type]
  (when (and (string? field-name)
             (keyword? base-type))
    (or (when (= "id" (s/lower-case field-name)) :id)
        (some (fn [[name-pattern valid-base-types special-type]]
                (when (and (contains? valid-base-types base-type)
                           (re-matches name-pattern (s/lower-case field-name)))
                  special-type))
              pattern+base-types+special-type))))


;;; ------------------------------------------------------------ Sync Util CRUD Fns ------------------------------------------------------------

(defn update-field!
  "Update an existing `Field` from the given FIELD-DEF."
  [{:keys [id], :as existing-field} {field-name :name, :keys [base-type special-type pk? parent-id]}]
  (u/prog1 (assoc existing-field
             :base_type    base-type
             :display_name (or (:display_name existing-field)
                               (humanization/name->human-readable-name field-name))
             :special_type (or (:special_type existing-field)
                               special-type
                               (when pk? :id)
                               (infer-field-special-type field-name base-type))

             :parent_id    parent-id)
    ;; if we have a different base-type or special-type, then update
    (when (first (d/diff <> existing-field))
      (db/update! Field id
        :display_name (:display_name <>)
        :base_type    base-type
        :special_type (:special_type <>)
        :parent_id    parent-id))))


(defn create-field!
  "Create a new `Field` from the given FIELD-DEF."
  [table-id {field-name :name, :keys [base-type special-type pk? parent-id raw-column-id]}]
  {:pre [(integer? table-id)
         (string? field-name)
         (contains? base-types base-type)]}
  (let [special-type (or special-type
                       (when pk? :id)
                       (infer-field-special-type field-name base-type))]
    (db/insert! Field
      :table_id      table-id
      :raw_column_id raw-column-id
      :name          field-name
      :display_name  (humanization/name->human-readable-name field-name)
      :base_type     base-type
      :special_type  special-type
      :parent_id     parent-id)))
