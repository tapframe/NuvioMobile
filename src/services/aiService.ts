import i18n from '../i18n';
import { mmkvStorage } from './mmkvStorage';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface MovieContext {
  id: string;
  title: string;
  overview: string;
  releaseDate: string;
  released?: boolean;
  genres: string[];
  cast: Array<{
    name: string;
    character: string;
  }>;
  crew: Array<{
    name: string;
    job: string;
  }>;
  runtime?: number;
  tagline?: string;
  keywords?: string[];
  voteAverage?: number;
  voteCount?: number;
  popularity?: number;
  budget?: number;
  revenue?: number;
  productionCompanies?: string[];
  productionCountries?: string[];
  spokenLanguages?: string[];
  originalLanguage?: string;
  status?: string;
  contentRating?: string;
  imdbId?: string;
}

export interface EpisodeContext {
  id: string;
  showId: string;
  showTitle: string;
  episodeTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  overview: string;
  airDate: string;
  released: boolean;
  runtime?: number;
  cast: Array<{
    name: string;
    character: string;
  }>;
  crew: Array<{
    name: string;
    job: string;
  }>;
  guestStars?: Array<{
    name: string;
    character: string;
  }>;
  // New enhanced fields
  voteAverage?: number;
  showGenres?: string[];
  showNetworks?: string[];
  showStatus?: string;
  contentRating?: string;
}

export interface SeriesContext {
  id: string;
  title: string;
  overview: string;
  firstAirDate: string;
  lastAirDate?: string;
  totalSeasons: number;
  totalEpisodes: number;
  genres: string[];
  cast: Array<{
    name: string;
    character: string;
  }>;
  crew: Array<{
    name: string;
    job: string;
  }>;
  episodesBySeason: Record<number, Array<{
    seasonNumber: number;
    episodeNumber: number;
    title: string;
    airDate: string;
    released: boolean;
    overview?: string;
    voteAverage?: number;
  }>>;
  // New enhanced fields
  networks?: string[];
  status?: string;
  originalLanguage?: string;
  popularity?: number;
  voteAverage?: number;
  voteCount?: number;
  createdBy?: string[];
  contentRating?: string;
  productionCompanies?: string[];
  type?: string; // "Scripted", "Documentary", etc.
}

export type ContentContext = MovieContext | EpisodeContext | SeriesContext;

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenRouterErrorResponse {
  error?: {
    message?: string;
    code?: string;
  };
}

class AIService {
  private static instance: AIService;
  private apiKey: string | null = null;
  private baseUrl = 'https://openrouter.ai/api/v1';
  private defaultModel = 'openrouter/free';

  private constructor() { }

  static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  async initialize(): Promise<boolean> {
    try {
      this.apiKey = await mmkvStorage.getItem('openrouter_api_key');
      return !!this.apiKey;
    } catch (error) {
      if (__DEV__) console.error('Failed to initialize AI service:', error);
      return false;
    }
  }

  async isConfigured(): Promise<boolean> {
    // Always refresh from storage so key changes in settings are picked up immediately.
    await this.initialize();
    return !!this.apiKey;
  }

  private async getPreferredModels(): Promise<string[]> {
    const configuredModel = (await mmkvStorage.getItem('openrouter_model'))?.trim();
    if (!configuredModel) {
      return [this.defaultModel];
    }
    return [configuredModel];
  }

  private async parseErrorResponse(response: Response): Promise<{
    statusLine: string;
    message: string;
    raw: string;
  }> {
    const raw = await response.text();
    let message = '';

    try {
      const parsed = JSON.parse(raw) as OpenRouterErrorResponse;
      message = parsed.error?.message || '';
    } catch {
      message = raw;
    }

    return {
      statusLine: `${response.status} ${response.statusText}`,
      message: (message || '').trim(),
      raw,
    };
  }

  private createSystemPrompt(context: ContentContext): string {
    const isSeries = 'episodesBySeason' in (context as any);
    const isEpisode = !isSeries && 'showTitle' in (context as any);

    if (isSeries) {
      const series = context as SeriesContext;
      const currentDate = new Date().toISOString().split('T')[0];
      const seasonsSummary = Object.keys(series.episodesBySeason)
        .sort((a, b) => Number(a) - Number(b))
        .map(sn => {
          const episodes = series.episodesBySeason[Number(sn)] || [];
          const releasedCount = episodes.filter(e => e.released).length;
          return `- Season ${sn}: ${episodes.length} episodes (${releasedCount} released)`;
        })
        .join('\n');
      return `You are an AI assistant with access to current, up-to-date information about the TV series "${series.title}" across ALL seasons and episodes.

CRITICAL: Today's date is ${currentDate}. Use ONLY the verified information provided below from our database. IGNORE any conflicting information from your training data which may be outdated.

VERIFIED CURRENT SERIES INFORMATION FROM DATABASE:
- Title: ${series.title}
- Original Language: ${series.originalLanguage || 'Unknown'}
- Status: ${series.status || 'Unknown'}
- First Air Date: ${series.firstAirDate || 'Unknown'}
- Last Air Date: ${series.lastAirDate || 'Unknown'}
- Seasons: ${series.totalSeasons}
- Episodes: ${series.totalEpisodes}
- Classification: ${series.type || 'Scripted'}
- Content Rating: ${series.contentRating || 'Not Rated'}
- Genres: ${series.genres.join(', ') || 'Unknown'}
- TMDB Rating: ${series.voteAverage ? `${series.voteAverage}/10 (${series.voteCount} votes)` : 'N/A'}
- Popularity Score: ${series.popularity || 'N/A'}
- Created By: ${series.createdBy?.join(', ') || 'Unknown'}
- Production: ${series.productionCompanies?.join(', ') || 'Unknown'}
- Synopsis: ${series.overview || 'No synopsis available'}

Cast:
${series.cast.map(c => `- ${c.name} as ${c.character}`).join('\n')}

Crew:
${series.crew.map(c => `- ${c.name} (${c.job})`).join('\n')}

Seasons & Episode Counts:
${seasonsSummary}

CRITICAL INSTRUCTIONS:
1. Never provide spoilers under any circumstances. Keep responses spoiler-safe.
2. The information above is from our verified database and is more current than your training data.
3. You can answer questions about ANY episode or season in the series. If dates indicate unreleased episodes, do not reveal plot details and clearly state they are unreleased.
4. Compare air dates to today's date (${currentDate}) to determine if an episode has already aired.
5. Base ALL responses on the verified information above, NOT on your training knowledge.
6. If asked about release dates or availability of episodes, refer ONLY to the database information provided.

FORMATTING RULES (use Markdown):
- Use short paragraphs separated by blank lines.
- Use clear headings (## or ###) when helpful.
- Use bullet lists for points and steps.
- Add a blank line before and after lists and headings.
- Keep lines concise; avoid giant unbroken blocks of text.
- Wrap inline code/terms with backticks only when appropriate.`;
    } else if (isEpisode) {
      const ep = context as EpisodeContext;
      const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      return `You are an AI assistant with access to current, up-to-date information about "${ep.showTitle}" Season ${ep.seasonNumber}, Episode ${ep.episodeNumber}: "${ep.episodeTitle}".

CRITICAL: Today's date is ${currentDate}. Use ONLY the verified information provided below from our database. IGNORE any conflicting information from your training data which is outdated.

VERIFIED CURRENT INFORMATION FROM DATABASE:
- Show: ${ep.showTitle}
- Episode: S${ep.seasonNumber}E${ep.episodeNumber} - "${ep.episodeTitle}"
- Air Date: ${ep.airDate || 'Unknown'}
- Release Status: ${ep.released ? 'RELEASED AND AVAILABLE FOR VIEWING' : 'Not Yet Released'}
- Runtime: ${ep.runtime ? `${ep.runtime} minutes` : 'Unknown'}
- TMDB Rating: ${ep.voteAverage ? `${ep.voteAverage}/10` : 'N/A'}
- Show Content Rating: ${ep.contentRating || 'Not Rated'}
- Show Genres: ${ep.showGenres?.join(', ') || 'Unknown'}
- Network: ${ep.showNetworks?.join(', ') || 'Unknown'}
- Show Status: ${ep.showStatus || 'Unknown'}
- Synopsis: ${ep.overview || 'No synopsis available'}

Cast:
${ep.cast.map(c => `- ${c.name} as ${c.character}`).join('\n')}

${ep.guestStars && ep.guestStars.length > 0 ? `Guest Stars:\n${ep.guestStars.map(g => `- ${g.name} as ${g.character}`).join('\n')}` : ''}

Crew:
${ep.crew.map(c => `- ${c.name} (${c.job})`).join('\n')}

CRITICAL INSTRUCTIONS:
1. Never provide spoilers under any circumstances. Always keep responses spoiler-safe.
2. The information above is from our verified database and is more current than your training data.
3. If Release Status shows "RELEASED AND AVAILABLE FOR VIEWING", the content IS AVAILABLE. Do not say it's "upcoming" or "unreleased".
4. Compare air dates to today's date (${currentDate}) to determine if something has already aired.
5. Base ALL responses on the verified information above, NOT on your training knowledge.
6. If asked about release dates or availability, refer ONLY to the database information provided.

FORMATTING RULES (use Markdown):
- Use short paragraphs separated by blank lines.
- Use clear headings (## or ###) when helpful.
- Use bullet lists for points, character lists, and steps.
- Add a blank line before and after lists and headings.
- Keep lines concise; avoid giant unbroken blocks of text.
- Wrap inline code/terms with backticks only when appropriate.
`;
    } else {
      const movie = context as MovieContext;
      const currentDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      return `You are an AI assistant with access to current, verified information about the movie "${movie.title}".

CRITICAL: Today's date is ${currentDate}. Use ONLY the verified information provided below from our database. IGNORE any conflicting information from your training data which is outdated.

VERIFIED CURRENT MOVIE INFORMATION FROM DATABASE:
- Title: ${movie.title}
- Original Language: ${movie.originalLanguage || 'Unknown'}
- Status: ${movie.status || 'Unknown'}
- Release Date: ${movie.releaseDate || 'Unknown'}
- Content Rating: ${movie.contentRating || 'Not Rated'}
- Runtime: ${movie.runtime ? `${movie.runtime} minutes` : 'Unknown'}
- Genres: ${movie.genres.join(', ') || 'Unknown'}
- TMDB Rating: ${movie.voteAverage ? `${movie.voteAverage}/10 (${movie.voteCount} votes)` : 'N/A'}
- Popularity Score: ${movie.popularity || 'N/A'}
- Budget: ${movie.budget && movie.budget > 0 ? `$${movie.budget.toLocaleString()}` : 'Unknown'}
- Revenue: ${movie.revenue && movie.revenue > 0 ? `$${movie.revenue.toLocaleString()}` : 'Unknown'}
- Production: ${movie.productionCompanies?.join(', ') || 'Unknown'}
- Countries: ${movie.productionCountries?.join(', ') || 'Unknown'}
- Spoken Languages: ${movie.spokenLanguages?.join(', ') || 'Unknown'}
- Tagline: ${movie.tagline || 'N/A'}
- Synopsis: ${movie.overview || 'No synopsis available'}
- IMDb ID: ${movie.imdbId || 'N/A'}

Cast:
${movie.cast.map(c => `- ${c.name} as ${c.character}`).join('\n')}

Crew:
${movie.crew.map(c => `- ${c.name} (${c.job})`).join('\n')}

${movie.keywords && movie.keywords.length > 0 ? `Keywords: ${movie.keywords.join(', ')}` : ''}

CRITICAL INSTRUCTIONS:
1. Never provide spoilers under any circumstances. Always keep responses spoiler-safe.
2. The information above is from our verified database and is more current than your training data.
3. Use the release date and today's date (${currentDate}) to determine availability - don't contradict database information.
4. Base ALL responses on the verified information above, NOT on your training knowledge.
5. If asked about release dates or availability, refer ONLY to the database information provided.
6. You can discuss themes, production, performances, and high-level plot setup without revealing twists, surprises, or outcomes.

FORMATTING RULES (use Markdown):
- Use short paragraphs separated by blank lines.
- Use clear headings (## or ###) when helpful.
- Use bullet lists for points and steps.
- Add a blank line before and after lists and headings.
- Keep lines concise; avoid giant unbroken blocks of text.

Answer questions about this movie using only the verified database information above, including plot analysis, character development, themes, cinematography, production notes, and trivia. Provide detailed, informative responses while remaining spoiler-safe.`;
    }
  }

  async sendMessage(
    message: string,
    context: ContentContext,
    conversationHistory: ChatMessage[] = []
  ): Promise<string> {
    if (!await this.isConfigured()) {
      throw new Error(i18n.t('errors.ai_not_configured'));
    }

    try {
      const systemPrompt = this.createSystemPrompt(context);

      // Prepare messages for API
      const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory
          .filter(msg => msg.role !== 'system')
          .slice(-10) // Keep last 10 messages for context
          .map(msg => ({
            role: msg.role,
            content: msg.content
          })),
        { role: 'user', content: message }
      ];

      if (__DEV__) {
        console.log('[AIService] Sending request to OpenRouter with context:', {
          contentType: 'showTitle' in context ? 'episode' : 'movie',
          title: 'showTitle' in context ?
            `${(context as EpisodeContext).showTitle} S${(context as EpisodeContext).seasonNumber}E${(context as EpisodeContext).episodeNumber}` :
            (context as MovieContext).title,
          messageCount: messages.length
        });
      }

      const model = (await this.getPreferredModels())[0];
      if (__DEV__) console.log('[AIService] Using model:', model);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://nuvio.app',
          'X-Title': 'Nuvio - AI Chat',
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 1000,
          temperature: 0.7,
          top_p: 0.9,
          frequency_penalty: 0.1,
          presence_penalty: 0.1,
        }),
      });

      if (!response.ok) {
        const parsedError = await this.parseErrorResponse(response);

        if (__DEV__) {
          console.error('[AIService] API Error:', {
            model,
            status: parsedError.statusLine,
            message: parsedError.message || parsedError.raw,
          });
        }

        throw new Error(`API request failed: ${parsedError.statusLine} - ${parsedError.message || parsedError.raw || 'Request failed'}`);
      }

      const data: OpenRouterResponse = await response.json();

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response received from AI service');
      }

      const responseContent = data.choices[0].message.content;

      if (__DEV__ && data.usage) {
        console.log('[AIService] Token usage:', data.usage);
      }

      return responseContent;
    } catch (error) {
      if (__DEV__) console.error('[AIService] Error sending message:', error);
      throw error;
    }
  }

  // Helper method to create context from TMDB movie data
  static createMovieContext(movieData: any): MovieContext {
    if (__DEV__) {
      console.log('[AIService] Creating movie context from TMDB data:', {
        id: movieData.id,
        title: movieData.title || movieData.name,
        hasCredits: !!movieData.credits,
        castCount: movieData.credits?.cast?.length || 0,
        crewCount: movieData.credits?.crew?.length || 0,
        hasKeywords: !!(movieData.keywords?.keywords || movieData.keywords?.results),
        keywordCount: (movieData.keywords?.keywords || movieData.keywords?.results)?.length || 0,
        genreCount: movieData.genres?.length || 0,
        tmdbStatus: movieData.status,
        tmdbReleaseDate: movieData.release_date,
        tmdbReleaseDatesBlock: !!movieData.release_dates
      });
    }

    // Prefer US theatrical release date from release_dates if available
    let releaseDate: string = movieData.release_date || movieData.first_air_date || '';
    try {
      const groups = movieData.release_dates?.results as any[] | undefined;
      const us = groups?.find(g => g.iso_3166_1 === 'US');
      const theatric = us?.release_dates?.find((r: any) => r.type === 3 || r.type === 2 || r.type === 4);
      const anyDate = us?.release_dates?.[0]?.release_date || theatric?.release_date;
      if (anyDate) {
        // TMDB returns full ISO timestamps; keep only date part
        releaseDate = String(anyDate).split('T')[0];
      }
    } catch { }
    const statusText: string = (movieData.status || '').toString().toLowerCase();
    let released = statusText === 'released';
    if (!released && releaseDate) {
      const d = new Date(releaseDate);
      if (!isNaN(d.getTime())) released = d.getTime() <= Date.now();
    }
    if (!released) {
      const hasOverview = typeof movieData.overview === 'string' && movieData.overview.trim().length > 40;
      const hasRuntime = typeof movieData.runtime === 'number' && movieData.runtime > 0;
      const hasVotes = typeof movieData.vote_average === 'number' && movieData.vote_average > 0;
      if (hasOverview || hasRuntime || hasVotes) released = true;
    }

    if (__DEV__) {
      console.log('[AIService] Movie release resolution:', {
        resolvedReleaseDate: releaseDate,
        statusText: (movieData.status || '').toString(),
        computedReleased: released,
        today: new Date().toISOString().split('T')[0]
      });
    }

    return {
      id: movieData.id?.toString() || '',
      title: movieData.title || movieData.name || '',
      overview: movieData.overview || '',
      releaseDate,
      released,
      genres: movieData.genres?.map((g: any) => g.name) || [],
      cast: movieData.credits?.cast?.slice(0, 10).map((c: any) => ({
        name: c.name,
        character: c.character
      })) || [],
      crew: movieData.credits?.crew?.slice(0, 5).map((c: any) => ({
        name: c.name,
        job: c.job
      })) || [],
      runtime: movieData.runtime,
      tagline: movieData.tagline,
      keywords: movieData.keywords?.keywords?.map((k: any) => k.name) ||
        movieData.keywords?.results?.map((k: any) => k.name) || [],
      // Enhanced fields
      voteAverage: movieData.vote_average,
      voteCount: movieData.vote_count,
      popularity: movieData.popularity,
      budget: movieData.budget,
      revenue: movieData.revenue,
      productionCompanies: movieData.production_companies?.map((c: any) => c.name) || [],
      productionCountries: movieData.production_countries?.map((c: any) => c.name) || [],
      spokenLanguages: movieData.spoken_languages?.map((l: any) => l.english_name || l.name) || [],
      originalLanguage: movieData.original_language,
      status: movieData.status,
      contentRating: (() => {
        // Extract US content rating from release_dates
        try {
          const usRelease = movieData.release_dates?.results?.find((r: any) => r.iso_3166_1 === 'US');
          const certification = usRelease?.release_dates?.find((d: any) => d.certification)?.certification;
          return certification || undefined;
        } catch { return undefined; }
      })(),
      imdbId: movieData.external_ids?.imdb_id || movieData.imdb_id,
    };
  }

  // Helper method to create context from TMDB episode data
  static createEpisodeContext(
    episodeData: any,
    showData: any,
    seasonNumber: number,
    episodeNumber: number
  ): EpisodeContext {
    // Compute release status from TMDB air date
    const airDate: string = episodeData.air_date || '';
    let released = false;
    try {
      if (airDate) {
        const parsed = new Date(airDate);
        if (!isNaN(parsed.getTime())) released = parsed.getTime() <= Date.now();
      }
    } catch { }
    // Heuristics: if TMDB provides meaningful content, treat as released
    if (!released) {
      const hasOverview = typeof episodeData.overview === 'string' && episodeData.overview.trim().length > 40;
      const hasRuntime = typeof episodeData.runtime === 'number' && episodeData.runtime > 0;
      const hasVotes = typeof episodeData.vote_average === 'number' && episodeData.vote_average > 0;
      if (hasOverview || hasRuntime || hasVotes) {
        released = true;
      }
    }
    if (__DEV__) {
      console.log('[AIService] Creating episode context from TMDB data:', {
        showId: showData.id,
        showTitle: showData.name || showData.title,
        episodeId: episodeData.id,
        episodeTitle: episodeData.name,
        season: seasonNumber,
        episode: episodeNumber,
        hasShowCredits: !!showData.credits,
        showCastCount: showData.credits?.cast?.length || 0,
        hasEpisodeCredits: !!episodeData.credits,
        episodeGuestStarsCount: episodeData.credits?.guest_stars?.length || 0,
        episodeCrewCount: episodeData.credits?.crew?.length || 0
      });
    }

    return {
      id: episodeData.id?.toString() || '',
      showId: showData.id?.toString() || '',
      showTitle: showData.name || showData.title || '',
      episodeTitle: episodeData.name || `Episode ${episodeNumber}`,
      seasonNumber,
      episodeNumber,
      overview: episodeData.overview || '',
      airDate,
      released,
      runtime: episodeData.runtime,
      cast: showData.credits?.cast?.slice(0, 8).map((c: any) => ({
        name: c.name,
        character: c.character
      })) || [],
      crew: episodeData.credits?.crew?.slice(0, 5).map((c: any) => ({
        name: c.name,
        job: c.job
      })) || showData.credits?.crew?.slice(0, 5).map((c: any) => ({
        name: c.name,
        job: c.job
      })) || [],
      guestStars: episodeData.credits?.guest_stars?.map((g: any) => ({
        name: g.name,
        character: g.character
      })) || [],
      // Enhanced fields
      voteAverage: episodeData.vote_average,
      showGenres: showData.genres?.map((g: any) => g.name) || [],
      showNetworks: showData.networks?.map((n: any) => n.name) || [],
      showStatus: showData.status,
      contentRating: (() => {
        // Extract US content rating from show's content_ratings
        try {
          const usRating = showData.content_ratings?.results?.find((r: any) => r.iso_3166_1 === 'US');
          return usRating?.rating || undefined;
        } catch { return undefined; }
      })(),
    };
  }

  // Helper to create a series-wide context including all episodes
  static createSeriesContext(showData: any, episodesBySeason: Record<number, any[]>): SeriesContext {
    // Build flattened cast/crew from show credits
    const cast = showData.credits?.cast?.slice(0, 12).map((c: any) => ({
      name: c.name,
      character: c.character
    })) || [];
    const crew = showData.credits?.crew?.slice(0, 8).map((c: any) => ({
      name: c.name,
      job: c.job
    })) || [];

    // Normalize episodes map
    const normalized: SeriesContext['episodesBySeason'] = {};
    Object.keys(episodesBySeason || {}).forEach(k => {
      const seasonNum = Number(k);
      normalized[seasonNum] = (episodesBySeason[seasonNum] || []).map((ep: any) => {
        const airDate: string = ep.air_date || '';
        let released = false;
        try {
          if (airDate) {
            const parsed = new Date(airDate);
            if (!isNaN(parsed.getTime())) released = parsed.getTime() <= Date.now();
          }
        } catch { }
        if (!released) {
          const hasOverview = typeof ep.overview === 'string' && ep.overview.trim().length > 40;
          const hasRuntime = typeof ep.runtime === 'number' && ep.runtime > 0;
          const hasVotes = typeof ep.vote_average === 'number' && ep.vote_average > 0;
          if (hasOverview || hasRuntime || hasVotes) released = true;
        }
        return {
          seasonNumber: ep.season_number ?? seasonNum,
          episodeNumber: ep.episode_number,
          title: ep.name || `Episode ${ep.episode_number}`,
          airDate,
          released,
          overview: ep.overview || '',
          voteAverage: ep.vote_average,
        };
      });
    });

    const totalSeasons = Array.isArray(showData.seasons)
      ? showData.seasons.filter((s: any) => s.season_number > 0).length
      : Object.keys(normalized).length;
    const totalEpisodes = Object.values(normalized).reduce((sum, eps) => sum + (eps?.length || 0), 0);

    return {
      id: showData.id?.toString() || '',
      title: showData.name || showData.title || '',
      overview: showData.overview || '',
      firstAirDate: showData.first_air_date || '',
      lastAirDate: showData.last_air_date || '',
      totalSeasons,
      totalEpisodes,
      genres: showData.genres?.map((g: any) => g.name) || [],
      cast,
      crew,
      episodesBySeason: normalized,
      // Enhanced fields
      networks: showData.networks?.map((n: any) => n.name) || [],
      status: showData.status,
      originalLanguage: showData.original_language,
      popularity: showData.popularity,
      voteAverage: showData.vote_average,
      voteCount: showData.vote_count,
      createdBy: showData.created_by?.map((c: any) => c.name) || [],
      contentRating: (() => {
        // Extract US content rating
        try {
          const usRating = showData.content_ratings?.results?.find((r: any) => r.iso_3166_1 === 'US');
          return usRating?.rating || undefined;
        } catch { return undefined; }
      })(),
      productionCompanies: showData.production_companies?.map((c: any) => c.name) || [],
      type: showData.type,
    };
  }

  // Generate conversation starter suggestions
  static generateConversationStarters(context: ContentContext): string[] {
    const isSeries = 'episodesBySeason' in (context as any);
    const isEpisode = !isSeries && 'showTitle' in (context as any);

    if (isSeries) {
      const series = context as SeriesContext;
      return [
        `What is ${series.title} about overall?`,
        `Summarize key arcs across all seasons`,
        `Which episodes are the highest rated and why?`,
        `List pivotal episodes for character development`,
        `How did themes evolve from Season 1 onward?`
      ];
    } else if (isEpisode) {
      const ep = context as EpisodeContext;
      return [
        `What happened in this episode of ${ep.showTitle}?`,
        `Explain the main plot points of "${ep.episodeTitle}"`,
        `What character development occurred in this episode?`,
        `Are there any hidden details or easter eggs I might have missed?`,
        `How does this episode connect to the overall story arc?`
      ];
    } else {
      const movie = context as MovieContext;
      return [
        `What is ${movie.title} about?`,
        `Explain the themes in this movie`,
        `What's the significance of the ending?`,
        `Tell me about the main characters and their development`,
        `Are there any interesting production facts about this film?`
      ];
    }
  }
}

export const aiService = AIService.getInstance();

// Export static methods for easier access
export const createMovieContext = AIService.createMovieContext;
export const createEpisodeContext = AIService.createEpisodeContext;
export const generateConversationStarters = AIService.generateConversationStarters;
export const createSeriesContext = AIService.createSeriesContext;
