
'use client';

import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { ArrowRight, UploadCloud, Edit, Share2, Music, Download, CheckCircle } from 'lucide-react';
import Image from 'next/image';
import { Link } from '@/i18n/routing';
import { placeholderImages } from '@/lib/placeholder-images';
import { useAuth } from '@/contexts/auth-context';
import { AnimatedSection } from '@/components/home/animated-section';
import { Footer } from '@/components/layout/footer';

const features = [
  {
    icon: UploadCloud,
    title: 'feature1Title',
    description: 'feature1Desc',
    highlighted: false,
  },
  {
    icon: Music,
    title: 'feature2Title',
    description: 'feature2Desc',
    highlighted: true,
  },
  {
    icon: Edit,
    title: 'feature3Title',
    description: 'feature3Desc',
    highlighted: false,
  },
  {
    icon: Share2,
    title: 'feature4Title',
    description: 'feature4Desc',
    highlighted: false,
  },
];

const testimonials = [
  {
    name: 'testimonial1Name',
    role: 'testimonial1Role',
    quote: 'testimonial1Quote',
    avatar: placeholderImages['avatar-1'].url,
  },
  {
    name: 'testimonial2Name',
    role: 'testimonial2Role',
    quote: 'testimonial2Quote',
    avatar: placeholderImages['avatar-2'].url,
  },
   {
    name: 'testimonial3Name',
    role: 'testimonial3Role',
    quote: 'testimonial3Quote',
    avatar: placeholderImages['avatar-3'].url,
  },
];

const pricingTiers = [
  {
    name: 'freeName',
    price: 0,
    priceDetails: 'month',
    features: ['freeFeature1', 'freeFeature2', 'freeFeature3'],
    cta: 'startForFree',
    available: true,
  },
  {
    name: 'basicName',
    price: 30,
    priceDetails: 'month',
    features: [
      'basicFeature1',
      'basicFeature2',
      'basicFeature3',
      'basicFeature4',
    ],
    cta: 'choosePlan',
    popular: true,
    available: false,
  },
  {
    name: 'proName',
    price: 99,
    priceDetails: 'month',
    features: [
      'proFeature1',
      'proFeature2',
      'proFeature3',
      'proFeature4',
    ],
    cta: 'choosePlan',
    available: false,
  },
];

export default function HomePage() {
  const t = useTranslations('home');
  const tPricing = useTranslations('pricing');
  const locale = useLocale();
  const { isAuthenticated } = useAuth();
  const formatPrice = (price: number) => new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(price);

  const ctaLink = isAuthenticated ? '/upload' : '/auth/login';

  return (
    <main className="bg-gray-50">
      {/* Hero Section */}
      <div className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-gray-50">
        <div className="absolute inset-0">
          <Image
            src={placeholderImages['main-bg'].url}
            alt="Musical background"
            fill
            priority
            className="h-full w-full object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-white/80"></div>
        </div>
        <div className="relative z-10 flex min-h-[calc(100vh-4rem)] items-center">
          <div className="mx-auto w-full max-w-7xl px-6 text-left text-gray-950">
            <h1 className="text-5xl font-semibold leading-tight tracking-tight lg:text-7xl">
              NOTEVERSE
              <br />
              <span className="text-orange-600">
                PRO
              </span>
            </h1>
            <p className="mt-6 max-w-2xl text-xl leading-relaxed text-gray-600">
              {t('heroSubtitle')}
            </p>
             <div className="mt-8 flex flex-col items-start justify-start gap-4 sm:flex-row">
                <Button 
                  size="lg"
                  className="group bg-orange-500 px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-orange-600"
                >
                  <Link href={ctaLink} className="flex items-center">
                    {tPricing('startForFree')}
                    <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </Button>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works Section */}
      <AnimatedSection className="py-24 sm:py-32 bg-gray-50/80">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-md bg-white px-4 py-1.5 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200">
            {t('howItWorksTitle')}
          </div>
          <h2 className="text-4xl sm:text-5xl font-medium text-gray-900 leading-tight mb-6">{t('howItWorksSubtitle')}</h2>
          <div className="relative mt-16 grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: UploadCloud, title: 'step1Title', desc: 'step1Desc' },
              { icon: Music, title: 'step2Title', desc: 'step2Desc' },
              { icon: Download, title: 'step3Title', desc: 'step3Desc' },
            ].map((step, index) => (
              <div key={index} className="text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-orange-100 text-orange-600">
                  <step.icon className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{t(step.title as never)}</h3>
                <p className="text-gray-600">{t(step.desc as never)}</p>
              </div>
            ))}
          </div>
        </div>
      </AnimatedSection>
      
      {/* Features Section */}
      <AnimatedSection id="features" className="py-24 sm:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid lg:grid-cols-3 gap-16">
            <div className="lg:col-span-1 space-y-6">
              <div className="inline-flex items-center gap-2">
                <span className="w-3 h-0.5 bg-orange-500"></span>
                <p className="font-semibold text-orange-500">{t('featuresTitle')}</p>
              </div>
              <h2 className="text-4xl sm:text-5xl font-medium text-gray-900 leading-tight">{t('featuresSubtitle')}</h2>
              <p className="text-gray-600 text-lg">
                {t('featuresDesc')}
              </p>
            </div>
            <div className="lg:col-span-2 grid sm:grid-cols-2 gap-6">
              {features.map((feature, index) => (
                <Card
                  key={index}
                  className={`rounded-lg p-6 transition-all duration-300 group ${
                    feature.highlighted
                      ? 'border-orange-200 bg-orange-50 text-gray-900 shadow-sm'
                      : 'bg-gray-50 text-gray-900 hover:-translate-y-1 hover:shadow-lg'
                  }`}
                >
                  <div className="space-y-4">
                    <feature.icon className="h-8 w-8 text-orange-500" />
                    <h3 className="text-xl font-semibold">{t(feature.title as never)}</h3>
                    <p className="text-gray-600">
                      {t(feature.description as never)}
                    </p>
                    <a href="#" className="flex items-center gap-2 text-sm font-semibold text-orange-600 transition-all group-hover:gap-3">
                      {t('viewDetails')}
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </AnimatedSection>

      {/* Testimonials Section */}
      <AnimatedSection className="py-24 sm:py-32 bg-gray-50">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row justify-between items-start gap-8 mb-12">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-1.5 text-sm font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200">
                {t('testimonialsTag')}
              </div>
              <h2 className="text-4xl sm:text-5xl font-medium text-gray-900 leading-tight">
                {t('testimonialsTitle')}
              </h2>
            </div>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {testimonials.map((testimonial, index) => (
              <Card key={index} className="space-y-6 rounded-lg bg-white p-8 shadow-sm">
                <p className="text-gray-600">&ldquo;{t(testimonial.quote as never) || testimonial.quote}&rdquo;</p>
                <div className="flex items-center gap-4">
                  <Image src={testimonial.avatar} alt={t(testimonial.name as never)} width={48} height={48} className="w-12 h-12 rounded-full object-cover" />
                  <div>
                    <p className="font-semibold text-gray-900">{t(testimonial.name as never) || testimonial.name}</p>
                    <p className="text-sm text-gray-500">{t(testimonial.role as never) || testimonial.role}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </AnimatedSection>

      {/* Pricing Section */}
       <AnimatedSection id="pricing" className="py-24 sm:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
           <div className="text-center">
            <h2 className="text-4xl sm:text-5xl font-medium text-gray-900 leading-tight mb-6">
              {tPricing('title')}
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              {tPricing('subtitle')}
            </p>
          </div>
          <div className="mt-16 grid lg:grid-cols-3 gap-8 items-stretch">
            {pricingTiers.map((tier) => (
              <Card key={tier.name} className={`flex flex-col rounded-lg shadow-sm ${tier.popular ? 'relative border-2 border-orange-500' : 'bg-gray-50'}`}>
                 {tier.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-orange-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
                    {tPricing('popular')}
                  </div>
                )}
                <CardHeader className="text-center pt-12 pb-8">
                  <CardTitle className="text-2xl font-bold">{tPricing(tier.name as never)}</CardTitle>
                  <p className="text-gray-500 mt-2">
                    <span className="text-4xl font-bold text-gray-900">
                      {formatPrice(tier.price)}
                    </span>
                    <span className="text-gray-500">
                      {tPricing(tier.priceDetails as never)}
                    </span>
                  </p>
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-4">
                    {tier.features.map((feature, i) => (
                      <li key={i} className="flex items-center">
                        <CheckCircle className="mr-3 h-5 w-5 text-green-500 shrink-0" />
                        <span className="text-gray-600">
                          {tPricing(feature as never)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter className="p-6">
                  {tier.available ? (
                    <Button
                      asChild
                      size="lg"
                      className="w-full border border-orange-500 bg-white text-orange-500 shadow-sm transition-colors hover:bg-orange-50"
                    >
                      <Link href={isAuthenticated ? '/upload' : '/auth/login'}>{tPricing(tier.cta as never)}</Link>
                    </Button>
                  ) : (
                    <Button disabled size="lg" className="w-full">
                      {tPricing('comingSoon')}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      </AnimatedSection>
      
      <Footer />
    </main>
  );
}

    

    

    
