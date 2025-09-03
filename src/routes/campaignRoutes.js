// backend/src/routes/campaignRoutes.js
const {
  // ... (existing imports)
  getMessageTemplates, // <-- IMPORT
} = require('../controllers/campaignController');

// ...

router.get('/templates', getMessageTemplates); // <-- ADD NEW ROUTE
router.post('/:id/send', executeCampaign);

module.exports = router;