import { describe, it, expect } from 'vitest';
import { detectSearchIntent } from '../server/routes/smart-search.js';

describe('detectSearchIntent', () => {
  it('detects car search queries', () => {
    expect(detectSearchIntent('cheapest car Long Island budget $10000 Tesla').type).toBe('cars');
    expect(detectSearchIntent('used Honda Civic for sale').type).toBe('cars');
    expect(detectSearchIntent('buy a cheap truck under $15000').type).toBe('cars');
    expect(detectSearchIntent('new BMW deal near 10001').type).toBe('cars');
    expect(detectSearchIntent('used Tesla under $30000').type).toBe('cars');
  });

  it('extracts car search params', () => {
    const result = detectSearchIntent('cheapest car budget $10000 near 11101');
    expect(result.type).toBe('cars');
    expect(result.params.maxPrice).toBe('10000');
    expect(result.params.zip).toBe('11101');
  });

  it('defaults zip to 10001 if not provided', () => {
    const result = detectSearchIntent('used Honda Civic for sale');
    expect(result.params.zip).toBe('10001');
  });

  it('detects flight search queries', () => {
    expect(detectSearchIntent('flights NYC to Fort Myers April 4').type).toBe('flights');
    expect(detectSearchIntent('fly to Miami').type).toBe('flights');
    expect(detectSearchIntent('airline tickets to LA').type).toBe('flights');
    expect(detectSearchIntent('cheap flights to London').type).toBe('flights');
  });

  it('detects hotel search queries', () => {
    expect(detectSearchIntent('hotels in Punta Gorda FL').type).toBe('hotels');
    expect(detectSearchIntent('cheap hotel near Manhattan').type).toBe('hotels');
    expect(detectSearchIntent('best resort in Cancun').type).toBe('hotels');
    expect(detectSearchIntent('airbnb in Brooklyn').type).toBe('hotels');
  });

  it('detects car rental queries', () => {
    expect(detectSearchIntent('rent a car in Miami').type).toBe('rental');
    expect(detectSearchIntent('car rental LAX').type).toBe('rental');
    expect(detectSearchIntent('rental car Fort Myers airport').type).toBe('rental');
  });

  it('detects restaurant queries', () => {
    expect(detectSearchIntent('best pizza in Manhattan').type).toBe('restaurants');
    expect(detectSearchIntent('good sushi near me').type).toBe('restaurants');
    expect(detectSearchIntent('cheap restaurants in Brooklyn').type).toBe('restaurants');
    expect(detectSearchIntent('best brunch in NYC').type).toBe('restaurants');
  });

  it('detects product search queries', () => {
    expect(detectSearchIntent('face wash for men').type).toBe('products');
    expect(detectSearchIntent('bouldering shoes size 10').type).toBe('products');
    expect(detectSearchIntent('running shoes Nike').type).toBe('products');
    expect(detectSearchIntent('buy headphones under $100').type).toBe('products');
    expect(detectSearchIntent('cheap laptop deals').type).toBe('products');
    expect(detectSearchIntent('best backpack for travel').type).toBe('products');
  });

  it('falls back to general for unrecognized queries', () => {
    expect(detectSearchIntent('latest AI news').type).toBe('general');
    expect(detectSearchIntent('what is TypeScript').type).toBe('general');
    expect(detectSearchIntent('how to cook pasta').type).toBe('general');
    expect(detectSearchIntent('machine learning tutorial').type).toBe('general');
  });
});
