/* Tətbiqin paylaşılan vəziyyəti. */

const state = {
  meta: null,
  demo: null,            // demo.json (yalnız ?demo=1)
  file: null,            // A: biznes plan
  extras: [],            // B: əlavə fayllar [{file, error}]
  sending: false,
  check: null,
  runStates: {},         // check_id → son görülən icra vəziyyəti (sol panelin yenilənməsi üçün)
  review: null,          // təsdiq ekranının redaktə vəziyyəti
  finFilter: 'hamisi',
  reqFilter: 'hamisi',
  reqGroup: '',
  reqQuery: '',
  lastFocus: null,

};

export { state };
