import type { DomainExtractResult } from './types.js';
import { tryParseJson } from './shared.js';

// ---------------------------------------------------------------------------
// 15. Allrecipes (Recipe Sites) extractor
// ---------------------------------------------------------------------------

export async function allrecipesExtractor(html: string, url: string): Promise<DomainExtractResult | null> {
  try {
    const { load } = await import('cheerio');
    const $ = load(html);

    // Try Schema.org Recipe JSON-LD first
    let recipe: any = null;
    $('script[type="application/ld+json"]').each((_: any, el: any) => {
      if (recipe) return;
      const raw = $(el).html() || '';
      const parsed = tryParseJson(raw);
      // Can be an array or direct object
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of candidates) {
        if (item?.['@type'] === 'Recipe' || (Array.isArray(item?.['@type']) && item['@type'].includes('Recipe'))) {
          recipe = item;
          break;
        }
        // Sometimes it's nested in @graph
        if (item?.['@graph']) {
          const graphRecipe = item['@graph'].find((g: any) => g?.['@type'] === 'Recipe');
          if (graphRecipe) { recipe = graphRecipe; break; }
        }
      }
    });

    let title: string;
    let ingredients: string[] = [];
    let instructions: string[] = [];
    let prepTime = '';
    let cookTime = '';
    let totalTime = '';
    let servings = '';
    let rating = '';
    let reviewCount = '';
    let description = '';

    if (recipe) {
      title = recipe.name || '';
      description = recipe.description || '';
      ingredients = (recipe.recipeIngredient || []).map((i: string) => i.trim());
      // Instructions can be strings or HowToStep objects
      const rawInstructions = recipe.recipeInstructions || [];
      for (const step of rawInstructions) {
        if (typeof step === 'string') instructions.push(step.trim());
        else if (step.text) instructions.push(step.text.trim());
        else if (step['@type'] === 'HowToSection' && step.itemListElement) {
          for (const s of step.itemListElement) {
            if (s.text) instructions.push(s.text.trim());
          }
        }
      }
      // Parse ISO 8601 duration (PT30M, PT1H30M)
      const parseDuration = (d: string) => {
        if (!d) return '';
        const h = d.match(/(\d+)H/)?.[1];
        const m = d.match(/(\d+)M/)?.[1];
        return [h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ');
      };
      prepTime = parseDuration(recipe.prepTime || '');
      cookTime = parseDuration(recipe.cookTime || '');
      totalTime = parseDuration(recipe.totalTime || '');
      servings = String(recipe.recipeYield || '');
      rating = recipe.aggregateRating?.ratingValue ? String(recipe.aggregateRating.ratingValue) : '';
      reviewCount = recipe.aggregateRating?.reviewCount ? String(recipe.aggregateRating.reviewCount) : '';
    } else {
      // HTML fallback
      title = $('h1').first().text().trim() ||
        $('meta[property="og:title"]').attr('content') || '';
      description = $('meta[property="og:description"]').attr('content') || '';
      $('[class*="ingredient"]').each((_: any, el: any) => {
        const text = $(el).text().trim();
        if (text && text.length < 200) ingredients.push(text);
      });
      $('[class*="instruction"] li, [class*="step"] li').each((_: any, el: any) => {
        const text = $(el).text().trim();
        if (text) instructions.push(text);
      });
    }

    if (!title) return null;

    const structured: Record<string, any> = {
      title, description, ingredients, instructions,
      prepTime, cookTime, totalTime, servings, rating, reviewCount, url,
    };

    const timeParts = [
      prepTime ? `Prep: ${prepTime}` : '',
      cookTime ? `Cook: ${cookTime}` : '',
      totalTime ? `Total: ${totalTime}` : '',
    ].filter(Boolean).join(' | ');
    const metaLine = [
      timeParts,
      servings ? `Servings: ${servings}` : '',
      rating ? `Rating: ${rating}${reviewCount ? ` (${reviewCount} reviews)` : ''}` : '',
    ].filter(Boolean).join(' | ');

    const ingredientsMd = ingredients.length
      ? `## Ingredients\n\n${ingredients.map(i => `- ${i}`).join('\n')}`
      : '';
    const instructionsMd = instructions.length
      ? `## Instructions\n\n${instructions.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : '';

    const cleanContent = `# 🍽️ ${title}\n\n${metaLine ? `*${metaLine}*\n\n` : ''}${description ? description + '\n\n' : ''}${ingredientsMd}\n\n${instructionsMd}`.trim();

    return { domain: 'allrecipes.com', type: 'recipe', structured, cleanContent };
  } catch {
    return null;
  }
}

