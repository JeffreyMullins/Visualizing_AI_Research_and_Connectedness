export type TMovie = {
    num_votes: number;
    runtime_minutes:  number;
    genres: string[];
    year: Date;
    average_rating: number;
    tconst: string;
    title_type: string;
    primary_title: string;
    original_title: string;
}

export type TWork = {
    id: string;
    pub_year: number;
    pub_date: Date;
    is_published: string;
    type: string;
    type_crossref: string;
    cited_by_count: number;
}

export type TAuthor = {
    work_id: string;
    a_id: string;
    position: string;
    countries: string[];
}

export type TKeyword = {
    work_id: string;
    keyword_id: string;
    keyword_score: number;
    keyword_name: string;
}

export type TReferenced_Work = {
    work_id: string;
    referenced_work_id: string;
}

export type TTopic = {
    work_id: string;
    topic_id: string;
    topic_display_name: string;
    topic_score: number;
    topic_sub_field_display_name: string;
    topic_field_display_name: string;
    topic_domain_display_name: string;
}

export type Tworks_with_author = {
    work_id: string;
    author_id: string;
    countries: string[];
    topic_field_display_name: string;
    pub_year: number;
}

export type Tsankey_authors = {
    first_publication_topic: string;
    publication_order: number;
    topic_order: number;
    author_count: number;
}

export type Tbubble_chart = {
    pub_year: number;
    topic_field_display_name: string;
    num_publications: number;
    cross_collaboration_metric: number;
    authors: number;
}

export type Tbar_chart_pubs = {
    pub_year: number;
    topic_field_display_name: string;
    id: number;
}