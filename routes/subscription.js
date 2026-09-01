// routes/subscription.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

router.post('/api/subscribe/trial', async (req, res) => {
  const { email, planCode } = req.body; // planCode corresponds to your paid monthly plan

  if (!email || !planCode) {
    return res.status(400).json({ error: 'Email and plan code are required.' });
  }

  // Calculate start date: 30 days from today
  const startDate = new Date();
  startDate.setDate(startDate.getDate() + 30);

  try {
    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email,
        plan: planCode,
        start_date: startDate.toISOString(), // Paystack delays billing until this date
        callback_url: `${process.env.APP_BASE_URL}/subscribe/success`
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return res.status(200).json({
      status: true,
      authorization_url: response.data.data.authorization_url,
      reference: response.data.data.reference
    });
  } catch (error) {
    console.error('Trial setup error:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Failed to initiate trial' });
  }
});

module.exports = router;