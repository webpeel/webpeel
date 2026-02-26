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
      name: 'event name or title',
      date: 'event date and time',
      location: 'venue or location',
      description: 'event description',
      price: 'ticket price or cost',
      organizer: 'event organizer',
      url: 'registration or ticket URL',
    },
  },
  recipe: {
    name: 'Recipe',
    description: 'Extract recipe information from cooking sites',
    fields: {
      title: 'recipe name',
      ingredients: 'list of ingredients with quantities',
      instructions: 'cooking steps or directions',
      prepTime: 'preparation time',
      cookTime: 'cooking time',
      servings: 'number of servings',
      calories: 'calories per serving',
      author: 'recipe author or source',
    },
  },
  job: {
    name: 'Job',
    description: 'Extract job posting information',
    fields: {
      title: 'job title',
      company: 'company name',
      location: 'job location',
      salary: 'salary range or compensation',
      description: 'job description',
      requirements: 'required qualifications or skills',
      type: 'job type (full-time, part-time, remote)',
      posted: 'date posted',
      applyUrl: 'application URL or link',
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
