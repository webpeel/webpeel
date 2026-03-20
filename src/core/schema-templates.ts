/**
 * Pre-built extraction schema templates for common use cases.
 * Used with quickAnswer BM25 extraction (no LLM needed).
 */

export interface SchemaTemplate {
  name: string;
  description: string;
  fields: Record<string, string>;
}

export const SCHEMA_TEMPLATES: Record<string, SchemaTemplate> = {
  product: {
    name: 'Product',
    description: 'Extract product information from e-commerce pages',
    fields: {
      name: 'What is the product name?',
      price: 'What is the price in dollars, euros, or other currency?',
      description: 'What are the main features and specifications of this product?',
      brand: 'What brand or company makes this product?',
      rating: 'What is the customer rating or review score?',
      availability: 'Is this product in stock or available for purchase?',
      image: 'What is the URL of the product image?',
      sku: 'What is the SKU, model number, or product identifier?',
    },
  },
  article: {
    name: 'Article',
    description: 'Extract article/blog post information',
    fields: {
      title: 'What is the title or headline of this article?',
      author: 'Who is the author or writer of this article?',
      date: 'When was this article published?',
      summary: 'What is the main point or summary of this article in one paragraph?',
      body: 'What is the full text of the article body?',
      tags: 'What topics, tags, or categories does this article cover?',
      source: 'What publication, website, or news source published this article?',
    },
  },
  listing: {
    name: 'Listing',
    description: 'Extract listing/directory items',
    fields: {
      items: 'list of items with name, price, and description',
      totalCount: 'total number of items or results',
      category: 'listing category or type',
      sortOrder: 'how items are sorted',
    },
  },
  contact: {
    name: 'Contact',
    description: 'Extract contact information',
    fields: {
      name: 'person or company name',
      email: 'email address',
      phone: 'phone number',
      address: 'physical address',
      website: 'website URL',
      company: 'company or organization name',
      social: 'social media links or handles',
    },
  },
  event: {
    name: 'Event',
    description: 'Extract event information',
    fields: {
      name: 'What is the name of this event?',
      date: 'When does this event take place?',
      time: 'What time does this event start?',
      location: 'Where is this event held?',
      price: 'How much does this event cost?',
      description: 'What is this event about?',
      organizer: 'Who is organizing this event?',
    },
  },
  recipe: {
    name: 'Recipe',
    description: 'Extract recipe information from cooking sites',
    fields: {
      name: 'What is the name of this recipe?',
      ingredients: 'What ingredients are needed? List all.',
      steps: 'What are the cooking steps or instructions?',
      prepTime: 'How long does preparation take?',
      cookTime: 'How long does cooking take?',
      servings: 'How many servings does this recipe make?',
      calories: 'How many calories per serving?',
      rating: 'What is the recipe rating?',
    },
  },
  job: {
    name: 'Job',
    description: 'Extract job posting information',
    fields: {
      title: 'What is the job title?',
      company: 'What company is hiring?',
      location: 'Where is the job located?',
      salary: 'What is the salary or compensation range?',
      type: 'Is this full-time, part-time, contract, or remote?',
      requirements: 'What are the key requirements or qualifications?',
      description: 'What is the job description?',
      applyUrl: 'What is the URL or method to apply?',
    },
  },
  business: {
    name: 'Business',
    description: 'Extract business/company information',
    fields: {
      name: 'What is the business name?',
      address: 'What is the full address?',
      phone: 'What is the phone number?',
      hours: 'What are the business hours?',
      rating: 'What is the business rating?',
      reviewCount: 'How many reviews does this business have?',
      website: 'What is the business website URL?',
      categories: 'What type of business is this?',
    },
  },
  review: {
    name: 'Review',
    description: 'Extract review information',
    fields: {
      title: 'review title',
      rating: 'rating or score',
      author: 'reviewer name',
      date: 'review date',
      body: 'review text or content',
      pros: 'positive points',
      cons: 'negative points',
      product: 'product or service being reviewed',
    },
  },
};

/**
 * Get a schema template by name, or return null if it's not a known template.
 * If the input looks like JSON, return null (let caller parse it as custom JSON).
 */
export function getSchemaTemplate(nameOrJson: string): SchemaTemplate | null {
  // If it starts with { or [, it's custom JSON, not a template name
  if (nameOrJson.trim().startsWith('{') || nameOrJson.trim().startsWith('[')) {
    return null;
  }

  const key = nameOrJson.toLowerCase().trim();
  return SCHEMA_TEMPLATES[key] || null;
}

/**
 * List all available schema template names.
 */
export function listSchemaTemplates(): string[] {
  return Object.keys(SCHEMA_TEMPLATES);
}
