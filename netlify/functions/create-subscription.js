// netlify/functions/create-subscription.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const { 
      amount, 
      currency, 
      donation_by, 
      name, 
      email, 
      phone, 
      address, 
      paymentMethodId 
    } = JSON.parse(event.body);

    if (!amount || amount <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid amount' }) };
    }

    if (!paymentMethodId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Payment method ID is required' }) };
    }

    // 1. Create a product for recurring donation
    const product = await stripe.products.create({
      name: 'Monthly Donation',
      description: donation_by || 'Recurring donation',
    });

    // 2. Create a price for the subscription
    const price = await stripe.prices.create({
      unit_amount: amount,
      currency: currency,
      recurring: { interval: 'month' },
      product: product.id,
    });

    // 3. Create a Stripe Customer with billing details
    const customer = await stripe.customers.create({
      name: name,
      email: email,
      phone: phone,
      address: {
        line1: address.line1,
        line2: address.line2 || '',
        city: address.city,
        state: address.state || '',
        postal_code: address.postal_code,
        country: address.country,
      },
    });

    // 4. Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customer.id,
    });

    // 5. Set as default payment method
    await stripe.customers.update(customer.id, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    // 6. Create the subscription
    try {
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: price.id }],
        expand: ['latest_invoice.payment_intent'],
      });

      // Return subscription details
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          status: subscription.status,
          subscriptionId: subscription.id,
          clientSecret: subscription.latest_invoice.payment_intent 
            ? subscription.latest_invoice.payment_intent.client_secret 
            : null,
        }),
      };
    } catch (subscriptionError) {
      // Handle cases where the initial payment fails
      if (subscriptionError.code === 'invoice_payment_intent_requires_action') {
        // Subscription created but requires authentication
        return {
          statusCode: 200,
          body: JSON.stringify({ 
            status: 'requires_action',
            subscriptionId: subscriptionError.subscription.id,
            clientSecret: subscriptionError.payment_intent.client_secret,
          }),
        };
      } else {
        throw subscriptionError;
      }
    }
  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};